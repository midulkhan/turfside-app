-- Push tokens were left on the first session of a login while refreshes rotated it, so they read
-- as "signed out" and got no pushes. Move each one to the newest session in its rotation chain
-- (only chains that still end in a live session; a real sign-out stays signed out).
with recursive chain as (
  select t.token, s.id, s.replaced_by, s.revoked_at
    from push_tokens t join sessions s on s.id = t.session_id
  union all
  select c.token, n.id, n.replaced_by, n.revoked_at
    from chain c join sessions n on n.id = c.replaced_by
)
update push_tokens t set session_id = c.id
  from chain c
 where c.token = t.token and c.replaced_by is null and c.revoked_at is null and t.session_id <> c.id;
