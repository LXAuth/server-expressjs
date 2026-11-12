-- Public-facing profile fields. Shown to other members of an organization
-- instead of an email address; never returned by login.
ALTER TABLE account_property
  ADD COLUMN name_id       varchar(50)
    CHECK (name_id ~ '^[a-z0-9](?:[a-z0-9_-]{1,48}[a-z0-9])$'),
  ADD COLUMN name_display  varchar(100),
  ADD COLUMN avatar_url    varchar(2048);

CREATE UNIQUE INDEX account_property_name_id_key ON account_property (name_id);
