-- Avatars (AI_ADS_TRAINING_INTEGRATION.md §1): each creative targets exactly
-- one BBM avatar, so the feedback loop can learn which avatar converts.
-- Nullable: creatives generated before avatars existed have none.

alter table creatives add column avatar text;
