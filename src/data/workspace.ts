import type { SupabaseClient } from '@supabase/supabase-js'

let cachedWorkspaceOwnerId: string | null = null
let cachedUserId: string | null = null

export function clearWorkspaceOwnerCache() {
  cachedWorkspaceOwnerId = null
  cachedUserId = null
}

export async function loadWorkspaceOwnerId(
  client: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (cachedWorkspaceOwnerId && cachedUserId === userId) return cachedWorkspaceOwnerId

  const { data, error } = await client.rpc('app_workspace_owner_id')
  if (!error && typeof data === 'string') {
    cachedWorkspaceOwnerId = data
    cachedUserId = userId
    return data
  }

  const row = await client
    .from('app_operators')
    .select('workspace_owner_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (!row.error && row.data?.workspace_owner_id) {
    cachedWorkspaceOwnerId = row.data.workspace_owner_id
    cachedUserId = userId
    return row.data.workspace_owner_id
  }
  return null
}
