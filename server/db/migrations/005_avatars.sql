-- Profile photo: the R2 object key (avatars/<user id>/<uuid>.webp). The URL is built from R2_PUBLIC_URL.
alter table users add column if not exists avatar_key text
  check (avatar_key is null or avatar_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$');
