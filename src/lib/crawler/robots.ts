export function parseRobotsTxt(content: string, userAgent: string = '*'): Set<string> {
  const disallowed = new Set<string>();
  const lines = content.split('\n').map((l) => l.trim());

  let applies = false;
  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue;

    if (line.toLowerCase().startsWith('user-agent:')) {
      const agent = line.slice('user-agent:'.length).trim();
      applies = agent === '*' || agent.toLowerCase() === userAgent.toLowerCase();
      continue;
    }

    if (applies && line.toLowerCase().startsWith('disallow:')) {
      const path = line.slice('disallow:'.length).trim();
      if (path) disallowed.add(path);
    }
  }

  return disallowed;
}

export function isAllowedByRobots(url: string, disallowed: Set<string>): boolean {
  const path = new URL(url).pathname;
  for (const rule of disallowed) {
    if (path.startsWith(rule)) return false;
  }
  return true;
}
