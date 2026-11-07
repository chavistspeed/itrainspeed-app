-- Approved release: existing Cron/net/Vault extensions are already installed.
-- Provision itrainspeed_assessment_mail_dispatch in Vault separately.
begin;
create function assessment_private.dispatch_pending_mail() returns bigint
language plpgsql set search_path=pg_catalog as $$
declare dispatch_secret text;
begin
 if not exists(select 1 from public.assessment_mail where state='pending') then return null; end if;
 select decrypted_secret into dispatch_secret from vault.decrypted_secrets where name='itrainspeed_assessment_mail_dispatch';
 if dispatch_secret is null then raise exception 'Assessment dispatch is not configured'; end if;
 return net.http_post(url:='https://app.itrainspeed.com/api/assessments/notifications',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||dispatch_secret),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function assessment_private.dispatch_pending_mail() from public,anon,authenticated,service_role;
select cron.schedule('itrainspeed-assessment-confirmations','*/5 * * * *',$$select assessment_private.dispatch_pending_mail();$$);
commit;
