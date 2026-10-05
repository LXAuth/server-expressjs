import { prisma } from '../../lib/prisma.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../../lib/password.js';
import { validationFailed, alreadyExists, badRequest, notFound, conflict } from '../../lib/errors.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { logger } from '../../lib/logger.js';
import type {
  AddAddressInput,
  AddEmailInput,
  ChangePasswordInput,
  RegisterInput,
  UpdateMeInput,
} from './user.schemas.js';

/**
 * User accounts and their related records.
 *
 * Every function here takes an authenticated `accountId`. Nothing accepts one
 * from the request body, so there is no path by which a caller can act on
 * another account.
 */

/** How long an email-verification token stays valid. */
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PublicUser {
  accountId: number;
  nameId: string | null;
  nameDisplay: string | null;
  avatarUrl: string | null;
  type: string;
  status: string;
  emails: Array<{ id: number; email: string; isPrimary: boolean; isVerified: boolean }>;
  addresses: Array<{ id: number; address: string; isPrimary: boolean }>;
  createdAt: Date;
}

/** The single place a user row becomes a response shape. */
function toPublicUser(record: {
  id: number;
  type: string;
  status: string;
  createdAt: Date;
  properties: { nameId: string; nameDisplay: string; avatarUrl: string | null } | null;
  emails: Array<{ id: number; email: string; isPrimary: boolean; isVerified: boolean }>;
  addresses: Array<{ id: number; address: string; isPrimary: boolean }>;
}): PublicUser {
  return {
    accountId: record.id,
    nameId: record.properties?.nameId ?? null,
    nameDisplay: record.properties?.nameDisplay ?? null,
    avatarUrl: record.properties?.avatarUrl ?? null,
    type: record.type,
    status: record.status,
    emails: record.emails.map((e) => ({
      id: e.id,
      email: e.email,
      isPrimary: e.isPrimary,
      isVerified: e.isVerified,
    })),
    addresses: record.addresses.map((a) => ({
      id: a.id,
      address: a.address,
      isPrimary: a.isPrimary,
    })),
    createdAt: record.createdAt,
  };
}

const USER_INCLUDE = {
  properties: true,
  emails: { orderBy: { isPrimary: 'desc' } },
  addresses: { orderBy: { isPrimary: 'desc' } },
} as const;

/**
 * Creates a user with its primary email, credentials, and properties in one
 * transaction.
 *
 * All four or none: an account row with no credentials cannot log in, and one
 * with no email cannot be verified. Leaving a half-built account behind would
 * need a repair path, and there is no case where partial registration is
 * useful.
 */
export async function register(input: RegisterInput): Promise<{ accountId: number }> {
  const policy = checkPasswordPolicy(input.password);
  if (!policy.ok) {
    throw validationFailed({ password: policy.problems }, 'Password does not meet policy.');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.accounts.create({
        data: {
          type: 'user',
          status: 'active',
          properties: {
            create: {
              nameId: input.nameId,
              nameDisplay: input.nameDisplay ?? input.nameId.replace(/^@/, ''),
            },
          },
          emails: {
            create: {
              email: input.email,
              isPrimary: true,
              // Not verified. The token comes back in the response because this
              // build has no mail transport; a real deployment sends it and
              // returns nothing.
              isVerified: false,
            },
          },
          credentials: { create: { passwordHash } },
          memberships: { create: { tier: 'free' } },
        },
        select: { id: true },
      });

      return created;
    });

    logger.info('User registered', { accountId: account.id });

    const verification = await issueEmailVerification(account.id, input.email);

    return {
      accountId: account.id,
      verificationToken: verification.token,
    };
  } catch (error) {
    // A unique violation on email or name_id. Checked rather than pattern
    // matched on message text, because Prisma's codes are stable and its
    // messages are not.
    if (isUniqueViolation(error)) {
      throw alreadyExists('An account with that email or name already exists.');
    }
    throw error;
  }
}

/** `GET /users/me` */
export async function getMe(accountId: number): Promise<PublicUser> {
  const record = await prisma.accounts.findUnique({
    where: { id: accountId },
    include: USER_INCLUDE,
  });

  if (!record) {
    throw notFound('Account', accountId);
  }
  return toPublicUser(record);
}

/** `PUT /users/me` — display name and avatar only. Credentials are elsewhere. */
export async function updateMe(
  accountId: number,
  input: UpdateMeInput,
): Promise<PublicUser> {
  const existing = await prisma.account_properties.findUnique({
    where: { accountId },
    select: { accountId: true },
  });

  if (!existing) {
    // An account always gets properties at registration, so this means the row
    // was removed out of band. Recreate rather than 404 on a PATCH-shaped
    // request.
    await prisma.account_properties.create({
      data: {
        accountId,
        nameId: `@user${accountId}`,
        nameDisplay: `User ${accountId}`,
        ...(input.nameDisplay === undefined ? {} : { nameDisplay: input.nameDisplay }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      },
    });
  } else {
    await prisma.account_properties.update({
      where: { accountId },
      data: {
        ...(input.nameDisplay === undefined ? {} : { nameDisplay: input.nameDisplay }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      },
    });
  }

  return getMe(accountId);
}

/**
 * `PUT /users/me/password`
 *
 * Revokes every session afterwards. A password change that leaves old refresh
 * tokens alive is not a password change — it is a way to keep access after
 * someone has rotated the credential.
 */
export async function changePassword(
  accountId: number,
  input: ChangePasswordInput,
): Promise<{ sessionsRevoked: number }> {
  const credentials = await prisma.account_credentials.findUnique({
    where: { accountId },
    select: { passwordHash: true },
  });

  if (!credentials) {
    throw badRequest('This account has no password set.');
  }

  const valid = await verifyPassword(credentials.passwordHash, input.currentPassword);
  if (!valid) {
    throw badRequest('Current password is incorrect.');
  }

  const policy = checkPasswordPolicy(input.newPassword);
  if (!policy.ok) {
    throw validationFailed({ password: policy.problems }, 'Password does not meet policy.');
  }

  if (await verifyPassword(credentials.passwordHash, input.newPassword)) {
    throw badRequest('New password must differ from the current one.');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.account_credentials.update({
    where: { accountId },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  await revokeAllSessions(accountId, 'password_changed');

  logger.info('Password changed, all sessions revoked', { accountId });

  const remaining = await prisma.refresh_tokens.count({
    where: { accountId, revokedAt: null },
  });

  return { sessionsRevoked: remaining };
}

/** `GET /users/me/organizations` */
export async function listMyOrganizations(accountId: number) {
  const memberships = await prisma.organization_members.findMany({
    where: { userId: accountId },
    select: {
      role: true,
      joinedAt: true,
      organization: {
        select: {
          id: true,
          status: true,
          properties: { select: { nameId: true, nameDisplay: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return memberships.map((membership) => ({
    organizationId: membership.organization.id,
    nameId: membership.organization.properties?.nameId ?? null,
    nameDisplay: membership.organization.properties?.nameDisplay ?? null,
    avatarUrl: membership.organization.properties?.avatarUrl ?? null,
    status: membership.organization.status,
    role: membership.role,
    joinedAt: membership.joinedAt,
  }));
}

/** `GET /users/me/emails` */
export async function listEmails(accountId: number) {
  const emails = await prisma.account_emails.findMany({
    where: { accountId },
    select: { id: true, email: true, isPrimary: true, isVerified: true, createdAt: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  return emails;
}

/**
 * `POST /users/me/emails`
 *
 * The new address starts unverified and is never primary here — an unverified
 * address cannot hold that role, so promotion happens through
 * `PUT /users/me/emails/{id}/primary` once the token comes back.
 */
export async function addEmail(
  accountId: number,
  input: AddEmailInput,
): Promise<{ id: number; email: string; verificationToken: string }> {
  const existing = await prisma.account_emails.findUnique({
    where: { email: input.email },
    select: { id: true, accountId: true },
  });

  if (existing) {
    throw alreadyExists('Email address');
  }

  const email = await prisma.account_emails.create({
    data: { accountId, email: input.email, isPrimary: false, isVerified: false },
    select: { id: true, email: true },
  });

  const verification = await issueEmailVerification(email.id, input.email);

  logger.info('Email added, verification issued', { accountId, emailId: email.id });

  return { id: email.id, email: email.email, verificationToken: verification.token };
}

/**
 * Marks an email verified when its token comes back.
 *
 * Exposed as part of the emails group because `POST /users/me/emails` is the
 * only way to obtain a token in this build — there is no mail transport, so the
 * token is returned directly and a client exercises verification with it.
 */
export async function verifyEmail(token: string): Promise<{ email: string }> {
  const tokenHash = hashToken(token);

  const pending = await prisma.account_email_verifications.findUnique({
    where: { tokenHash },
    select: { id: true, emailId: true, expiresAt: true, email: { select: { email: true, accountId: true } } },
  });

  if (!pending) {
    throw badRequest('Verification token is not recognised.');
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    throw badRequest('Verification token has expired.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.account_emails.update({
      where: { id: pending.emailId },
      data: { isVerified: true },
    });
    // Single use. Deleting rather than marking, since a verified email needs no
    // pending token.
    await tx.account_email_verifications.delete({ where: { id: pending.id } });
  });

  logger.info('Email verified', { accountId: pending.email.accountId, emailId: pending.emailId });

  return { email: pending.email.email };
}

/**
 * `PUT /users/me/emails/{email_id}/primary`
 *
 * Only a verified address can become primary — otherwise an account could lock
 * a real address out of its own account by pointing primary at an unverified
 * one and then changing the password.
 */
export async function setPrimaryEmail(
  accountId: number,
  emailId: number,
): Promise<{ emailId: number }> {
  const email = await prisma.account_emails.findFirst({
    where: { id: emailId, accountId },
    select: { id: true, isVerified: true },
  });

  if (!email) {
    throw notFound('Email', emailId);
  }
  if (!email.isVerified) {
    throw conflict('Only a verified email address can be made primary.');
  }

  // The one_primary_email_per_account partial index would reject this write if
  // the demotion were not part of the same transaction.
  await prisma.$transaction([
    prisma.account_emails.updateMany({
      where: { accountId, isPrimary: true },
      data: { isPrimary: false },
    }),
    prisma.account_emails.update({
      where: { id: emailId },
      data: { isPrimary: true },
    }),
  ]);

  return { emailId };
}

/** `GET /users/me/addresses` */
export async function listAddresses(accountId: number) {
  return prisma.account_addresses.findMany({
    where: { accountId },
    select: { id: true, address: true, isPrimary: true, createdAt: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
}

/**
 * `POST /users/me/addresses`
 *
 * Unlike an email, an address has no verification step — it is a self-asserted
 * label, not a claim of control that something else must confirm.
 */
export async function addAddress(
  accountId: number,
  input: AddAddressInput,
): Promise<{ id: number; address: string; isPrimary: boolean }> {
  const count = await prisma.account_addresses.count({ where: { accountId } });

  // The first address is primary whether or not the caller asked, or the
  // account would have no primary and no way to set one without two addresses.
  const isPrimary = input.isPrimary || count === 0;

  if (isPrimary && count > 0) {
    await prisma.account_addresses.updateMany({
      where: { accountId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const created = await prisma.account_addresses.create({
    data: { accountId, address: input.address, isPrimary },
    select: { id: true, address: true, isPrimary: true },
  });

  return created;
}

/**
 * Issues a verification token, storing only its hash.
 *
 * Any outstanding token for the same email is deleted first, so requesting a
 * new one invalidates the old rather than leaving two live.
 */
async function issueEmailVerification(
  emailId: number,
  email: string,
): Promise<{ token: string }> {
  const token = generateToken(32);

  const existing = await prisma.account_email_verifications.findMany({
    where: { emailId },
    select: { id: true },
  });
  if (existing.length > 0) {
    await prisma.account_email_verifications.deleteMany({
      where: { id: { in: existing.map((e) => e.id) } },
    });
  }

  await prisma.account_email_verifications.create({
    data: {
      tokenHash: hashToken(token),
      emailId,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });

  logger.debug('Email verification issued', { emailId, email });
  return { token };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
