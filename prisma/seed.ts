/**
 * Seed data: one user, one organization, the owner membership that links them,
 * and a founding team.
 *
 * Idempotent — safe to run repeatedly. Each entity is resolved by its natural
 * key (`account_properties.name_id`) and then created or updated, so a second
 * run converges instead of colliding.
 *
 *   npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { config } from '../src/config.js';

const prisma = new PrismaClient();

const SEED_USER = {
  email: 'owner@example.com',
  password: 'ChangeMe123!',
  nameId: '@lxowner',
  nameDisplay: 'LX Owner',
} as const;

const SEED_ORGANIZATION = {
  nameId: '@lxauth',
  nameDisplay: 'LXAuth',
} as const;

const SEED_TEAM = {
  name: 'Founding team',
  description: 'Created by the seed script.',
} as const;

async function seedUser(passwordHash: string): Promise<number> {
  const existing = await prisma.account_properties.findUnique({
    where: { nameId: SEED_USER.nameId },
    select: { accountId: true },
  });

  if (existing) {
    console.log(`  user exists     account ${existing.accountId}`);
    return existing.accountId;
  }

  const account = await prisma.accounts.create({
    data: {
      type: 'user',
      status: 'active',
      properties: {
        create: {
          nameId: SEED_USER.nameId,
          nameDisplay: SEED_USER.nameDisplay,
        },
      },
      emails: {
        create: {
          email: SEED_USER.email,
          isPrimary: true,
          // No mail transport in this build, so the seed marks the address
          // verified directly. Accounts created through the API are not.
          isVerified: true,
        },
      },
      credentials: { create: { passwordHash } },
      memberships: { create: { tier: 'enterprise' } },
    },
    select: { id: true },
  });

  console.log(`  user created    account ${account.id}`);
  return account.id;
}

async function seedOrganization(): Promise<number> {
  const existing = await prisma.account_properties.findUnique({
    where: { nameId: SEED_ORGANIZATION.nameId },
    select: { accountId: true },
  });

  if (existing) {
    console.log(`  org exists      account ${existing.accountId}`);
    return existing.accountId;
  }

  const organization = await prisma.accounts.create({
    data: {
      type: 'organization',
      status: 'active',
      properties: {
        create: {
          nameId: SEED_ORGANIZATION.nameId,
          nameDisplay: SEED_ORGANIZATION.nameDisplay,
        },
      },
    },
    select: { id: true },
  });

  console.log(`  org created     account ${organization.id}`);
  return organization.id;
}

/**
 * The row the one_owner_per_org partial index protects. Checked before writing
 * rather than upserted on the composite key, so a re-run never trips the index.
 */
async function seedOwnerMembership(organizationId: number, userId: number): Promise<void> {
  const existing = await prisma.organization_members.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });

  if (existing) {
    if (existing.role === 'owner') {
      console.log('  owner exists');
      return;
    }
    await prisma.organization_members.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { role: 'owner' },
    });
    console.log('  owner promoted');
    return;
  }

  await prisma.organization_members.create({
    data: { organizationId, userId, role: 'owner' },
  });
  console.log('  owner created');
}

async function seedTeam(organizationId: number): Promise<void> {
  const existing = await prisma.organization_teams.findFirst({
    where: { organizationId, name: SEED_TEAM.name },
    select: { id: true },
  });

  if (existing) {
    console.log(`  team exists     ${existing.id}`);
    return;
  }

  const team = await prisma.organization_teams.create({
    data: {
      organizationId,
      name: SEED_TEAM.name,
      description: SEED_TEAM.description,
    },
    select: { id: true },
  });

  console.log(`  team created    ${team.id}`);
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(SEED_USER.password, {
    type: argon2.argon2id,
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
  });

  const userId = await seedUser(passwordHash);
  const organizationId = await seedOrganization();
  await seedOwnerMembership(organizationId, userId);
  await seedTeam(organizationId);

  console.log('\nSeed complete.');
  console.log(`  login           ${SEED_USER.email} / ${SEED_USER.password}`);
  console.log(`  organization    account ${organizationId}`);
  console.log(`  owner           account ${userId}`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
