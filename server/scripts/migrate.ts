import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pool } from '../db.js'
import { encryptPersonalData, isPersonalDataEncryptionConfigured } from '../services/personal-data.js'

try {
  const migrations = [
    '001_init.sql',
    '002_session_store_sid.sql',
    '003_collaborators.sql',
    '004_encrypt_collaborator_birth_dates.sql',
    '005_leave_and_child_gender.sql',
    '006_tickets_and_schedule.sql',
    '007_ticket_sync_activation.sql',
    '008_init_ticket_sync_state.sql',
    '009_ticket_activity_and_files.sql',
    '010_collaborator_photos_programming_supplies.sql',
    '011_enterprise_information.sql',
    '012_collaborator_deletion_audit.sql',
    '013_optional_employee_data_and_registration.sql',
    '014_custom_collaborator_roles.sql',
    '015_standalone_programming.sql',
    '016_programming_role_visibility.sql',
    '017_programming_completion_and_foremen.sql',
    '018_user_profiles.sql',
    '019_signature_pin_protection.sql',
    '020_persist_user_profile_name.sql',
    '021_subsubject_warranties.sql',
    '022_legal_processes.sql',
    '023_legal_process_collaboration.sql',
    '024_ticket_tags_and_cv_conversation.sql',
    '025_user_page_access.sql',
    '026_decimal_ticket_workflow_order.sql',
  ]
  for (const migrationName of migrations) {
    const migration = await readFile(resolve('server/migrations', migrationName), 'utf8')
    await pool.query(migration)
  }

  const legacyDateColumn = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'collaborators'
         AND column_name = 'birth_date'
     ) AS exists`,
  )

  if (legacyDateColumn.rows[0].exists) {
    const existing = await pool.query<{ id: string; birth_date: string }>(
      `SELECT id, birth_date::text FROM collaborators WHERE birth_date_ciphertext IS NULL`,
    )
    if (existing.rowCount && !isPersonalDataEncryptionConfigured()) {
      throw new Error('Configure PII_ENCRYPTION_KEY antes de migrar datas de nascimento existentes.')
    }

    for (const collaborator of existing.rows) {
      await pool.query(
        `UPDATE collaborators SET birth_date_ciphertext = $1 WHERE id = $2`,
        [encryptPersonalData(collaborator.birth_date, 'birth-date'), collaborator.id],
      )
    }
    await pool.query('ALTER TABLE collaborators DROP COLUMN birth_date')
  }

  await pool.query('ALTER TABLE collaborators ALTER COLUMN birth_date_ciphertext SET NOT NULL')

  const childrenWithoutGender = await pool.query<{ id: string }>(
    `SELECT id FROM collaborator_children WHERE gender_ciphertext IS NULL`,
  )
  if (childrenWithoutGender.rowCount && !isPersonalDataEncryptionConfigured()) {
    throw new Error('Configure PII_ENCRYPTION_KEY antes de migrar gênero de filhos existentes.')
  }
  for (const child of childrenWithoutGender.rows) {
    await pool.query(
      `UPDATE collaborator_children SET gender_ciphertext = $1 WHERE id = $2`,
      [encryptPersonalData('nao_informar', 'child-gender'), child.id],
    )
  }
  await pool.query('ALTER TABLE collaborator_children ALTER COLUMN gender_ciphertext SET NOT NULL')
  console.log('Migrações PostgreSQL aplicadas com sucesso.')
} catch (error) {
  console.error('Não foi possível aplicar a migração:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}