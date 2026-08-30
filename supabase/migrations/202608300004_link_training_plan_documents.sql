-- Vincula cada PDF al plan exacto y permite al entrenador retirar sus propios adjuntos.
-- No modifica tablas, funciones ni automatismos de cobro.

alter table public.club_documents
  add column if not exists training_plan_id uuid references public.training_plans(id) on delete cascade;

create index if not exists club_documents_training_plan_id_idx
  on public.club_documents(training_plan_id)
  where training_plan_id is not null;

drop policy if exists "club documents plan owner delete" on public.club_documents;
create policy "club documents plan owner delete"
on public.club_documents for delete
using (
  document_type = 'training_plan'
  and training_group_id is not null
  and public.can_manage_group(training_group_id)
);

drop policy if exists "club plan storage owner delete" on storage.objects;
create policy "club plan storage owner delete"
on storage.objects for delete
using (
  bucket_id = 'club-private-documents'
  and exists (
    select 1
    from public.training_groups g
    where g.id::text = (storage.foldername(name))[2]
      and public.can_manage_group(g.id)
  )
);
