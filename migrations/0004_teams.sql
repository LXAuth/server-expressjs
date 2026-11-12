-- Teams inside an organization. A team member must be a member of the
-- organization: the composite foreign key removes team memberships
-- automatically when someone leaves or is removed from the organization.

CREATE TABLE teams (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name             varchar(100)  NOT NULL,
  description      varchar(500),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX teams_org_name_key ON teams (organization_id, lower(name));

CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE team_members (
  team_id          uuid         NOT NULL,
  organization_id  uuid         NOT NULL,
  account_id       uuid         NOT NULL,
  role             varchar(16)  NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  joined_at        timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, account_id),
  FOREIGN KEY (team_id, organization_id) REFERENCES teams (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, account_id)
    REFERENCES organization_members (organization_id, account_id) ON DELETE CASCADE
);

CREATE INDEX team_members_account_idx ON team_members (account_id);
