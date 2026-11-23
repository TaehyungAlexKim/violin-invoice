# Backup and Restore

Each week and after finalized invoice batches:

1. Use an authenticated local operator environment to create a schema/data logical dump.
2. Encrypt it with age or GPG.
3. Store it in an access-controlled off-site location; never in this repository or GitHub Pages.
4. Keep at least two generations and store decryption credentials separately.
5. Restore quarterly to an isolated project/database and run migrations and database tests.

PDF files and customer exports must not be stored in Supabase Storage or this repository.
