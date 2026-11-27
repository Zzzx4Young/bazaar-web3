// sudo commonly clears COMPOSE_PROJECT_NAME. Pass the explicit selection in argv.
export function composeProjectArgs(project) {
  if (project === undefined) return []
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project))
    throw new Error('Invalid isolated Compose project name')
  return ['--project-name', project]
}
