import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import ExcelJS from 'exceljs'
import { parseCSV, spreadsheetPreview, fileKind, cellText } from '../lib/assessment-spreadsheet.js'

test('CSV previews retain quoted commas, line breaks, escaped quotes and zero scores', async () => {
  assert.deepEqual(parseCSV('\uFEFFTest,Result\r\n"Jump, standing",0\r\n"Coach ""note""\nline",2'), [['Test','Result'],['Jump, standing','0'],['Coach "note"\nline','2']])
  assert.throws(() => parseCSV('"unfinished'), /unfinished/)
  assert.equal(fileKind('RESULTS.XLSX'), 'spreadsheet')
  assert.throws(() => fileKind('program.html'), /Choose/)
  assert.equal(cellText({ formula: '1+1', result: 0 }), '0')
})

test('Excel previews preserve sheets and cached values without executing formulas', async () => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Speed results')
  sheet.addRow(['Test', 'Result', 'Notes'])
  sheet.addRow(['10m fly', 1.35, { richText: [{ text: 'Improved ' }, { text: 'posture' }] }])
  sheet.addRow(['Formula', { formula: '1+1', result: 2 }])
  const bytes = await book.xlsx.writeBuffer()
  const preview = await spreadsheetPreview({ name: 'results.xlsx', arrayBuffer: async () => bytes })
  assert.equal(preview[0].name, 'Speed results')
  assert.deepEqual(preview[0].rows[1], ['10m fly', '1.35', 'Improved posture'])
  assert.equal(preview[0].rows[2][1], '2')
  const large = await spreadsheetPreview({ name: 'results.csv', text: async () => Array.from({ length: 205 }, (_, i) => `${i},value`).join('\n') })
  assert.equal(large[0].rows.length, 200)
  assert.equal(large[0].truncated, true)
})

test('reports and files restrict drafts, other families, parent writes and removed attachments', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth,storage to authenticated,anon;
      create table public.profiles(id uuid primary key, role text);
      create table public.athletes(id uuid primary key, guardian_id uuid);
      alter table profiles enable row level security;
      alter table athletes enable row level security;
      create policy profile_self on profiles for select using(id=auth.uid());
      create policy athlete_self on athletes for select using(guardian_id=auth.uid());
      grant select on profiles,athletes to authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
      insert into profiles values('00000000-0000-0000-0000-000000000001','coach'),('00000000-0000-0000-0000-000000000002','parent'),('00000000-0000-0000-0000-000000000003','parent');
      insert into athletes values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
    `)
    await db.exec(await readFile(new URL('../supabase/assessment-reports.sql', import.meta.url), 'utf8'))
    const actor = async (n, run) => {
      await db.query("select set_config('test.uid',$1,false)", [`00000000-0000-0000-0000-00000000000${n}`])
      await db.exec('set role authenticated')
      try { return await run() } finally { await db.exec('reset role') }
    }
    let id, path
    await actor(1, async () => {
      id = (await db.query("insert into athlete_assessments(athlete_id,title) values('10000000-0000-0000-0000-000000000001','Speed assessment') returning id")).rows[0].id
      path = `${id}/test-video.mp4`
      await db.query("insert into storage.objects(bucket_id,name) values('assessment-files',$1)", [path])
      await db.query('update athlete_assessments set attachments=$1::jsonb where id=$2', [JSON.stringify([{ path }]), id])
      assert.equal((await db.query('select * from athlete_assessments')).rows.length, 1)
    })
    await actor(2, async () => {
      assert.equal((await db.query('select * from athlete_assessments')).rows.length, 0)
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
      await assert.rejects(db.query("insert into athlete_assessments(athlete_id,title,status) values('10000000-0000-0000-0000-000000000001','bad','published')"), /row-level security/)
    })
    await actor(1, () => db.query("update athlete_assessments set status='published' where id=$1", [id]))
    await actor(2, async () => {
      assert.equal((await db.query('select * from athlete_assessments')).rows.length, 1)
      assert.equal((await db.query('select * from storage.objects')).rows.length, 1)
      assert.equal((await db.query("update athlete_assessments set notes='changed' returning id")).rows.length, 0)
      assert.equal((await db.query('delete from athlete_assessments returning id')).rows.length, 0)
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('assessment-files',$1)", [`${id}/bad.mp4`]), /row-level security/)
    })
    await actor(3, async () => {
      assert.equal((await db.query('select * from athlete_assessments')).rows.length, 0)
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
    })
    await actor(1, () => db.query("update athlete_assessments set attachments='[]'::jsonb where id=$1", [id]))
    await actor(2, async () => assert.equal((await db.query('select * from storage.objects')).rows.length, 0))
    await actor(1, () => db.query("update athlete_assessments set status='draft' where id=$1", [id]))
    await actor(2, async () => assert.equal((await db.query('select * from athlete_assessments')).rows.length, 0))
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from athlete_assessments'), /permission denied/)
    await db.exec('reset role')
  } finally { await db.close() }
})
