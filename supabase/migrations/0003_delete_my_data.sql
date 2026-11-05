-- delete_my_data() now also clears pending inline-button values of the server bot (bot_pending, added in 0002).
create or replace function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.sync_rows where user_id = auth.uid();
  delete from public.bot_messages where user_id = auth.uid();
  delete from public.bot_pending where user_id = auth.uid();
  delete from public.telegram_links where user_id = auth.uid();
  delete from public.link_codes where user_id = auth.uid();
  delete from public.notification_schedules where user_id = auth.uid();
  delete from public.notification_log where user_id = auth.uid();
  delete from public.ai_usage where user_id = auth.uid();
  delete from public.devices where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
  delete from storage.objects where bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text;
end $$;
