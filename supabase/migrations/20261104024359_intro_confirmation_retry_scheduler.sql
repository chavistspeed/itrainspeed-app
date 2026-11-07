-- Applied to the approved production project after v1-6-intro-approval.sql.
-- The dispatch token is provisioned separately in Vault; no secret belongs here.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function intro_private.dispatch_pending_mail() returns bigint
language plpgsql set search_path=pg_catalog as $$
declare dispatch_secret text;
begin
 if not exists(select 1 from public.intro_mail where state='pending') then return null; end if;
 select decrypted_secret into dispatch_secret from vault.decrypted_secrets where name='itrainspeed_intro_mail_dispatch';
 if dispatch_secret is null then raise exception 'Intro dispatch is not configured'; end if;
 return net.http_post(url:='https://app.itrainspeed.com/api/intro/notifications',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||dispatch_secret),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function intro_private.dispatch_pending_mail() from public,anon,authenticated,service_role;

select cron.schedule('itrainspeed-intro-confirmations','*/5 * * * *',$$select intro_private.dispatch_pending_mail();$$);
