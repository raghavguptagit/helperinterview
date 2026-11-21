export interface ExtractedProject {
  name: string;
  description: string;
  technologies: string[];
}

interface TechRule {
  label: string;
  pattern: RegExp;
}

const TECH_RULES: TechRule[] = [
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'Java', pattern: /\bjava\b(?!script)/i },
  { label: 'TypeScript', pattern: /\btypescript\b/i },
  { label: 'JavaScript', pattern: /\bjavascript\b|\besnext\b|\bes6\b/i },
  { label: 'React', pattern: /\breact(?:\.js|js|\s*1[6-9])?\b/i },
  { label: 'Next.js', pattern: /\bnext\.?js\b/i },
  { label: 'Node.js', pattern: /\bnode\.?js\b|\bexpress\b|\bnestjs\b/i },
  { label: 'SQL / PostgreSQL', pattern: /\bsql\b|\bpostgresql\b|\bpostgres\b|\bmysql\b|\bsqlite\b/i },
  { label: 'MongoDB', pattern: /\bmongodb\b|\bmongoose\b/i },
  { label: 'Redis', pattern: /\bredis\b/i },
  { label: 'Go', pattern: /\bgolang\b|\bgo\s*(?:microservices|services|backend|api)\b|(?:languages?|stack)[^\n]*\bgo\b/i },
  { label: 'C++', pattern: /(?:^|[\s,(/])c\+\+(?:$|[\s,)/.;])/i },
  { label: 'FastAPI / Django / Flask', pattern: /\bfastapi\b|\bdjango\b|\bflask\b/i },
  { label: 'Spring Boot', pattern: /\bspring\s*boot\b|\bspring\b/i },
  { label: 'AI / ML', pattern: /\b(?:ai|ml|machine learning|deep learning|pytorch|tensorflow|scikit-learn|llm|langchain|rag|nlp|gen\s*ai|gemini|openai)\b/i },
  { label: 'GraphQL', pattern: /\bgraphql\b/i },
  { label: 'Kafka / RabbitMQ', pattern: /\bkafka\b|\brabbitmq\b|\bmessage queue\b/i },
  { label: 'Docker / Kubernetes', pattern: /\bdocker\b|\bkubernetes\b|\bk8s\b/i },
  { label: 'AWS / Cloud', pattern: /\baws\b|\bgcp\b|\bazure\b|\bcloud\b/i },
  { label: 'System Design', pattern: /\bsystem design\b|\bdistributed systems\b|\bmicroservices\b|\barchitecture\b/i },
];

export const COMMON_TECH_OPTIONS = [
  'Python',
  'Java',
  'TypeScript',
  'JavaScript',
  'React',
  'Node.js',
  'SQL / PostgreSQL',
  'AI / ML',
  'System Design',
  'Docker / Kubernetes',
  'AWS / Cloud',
];

export function extractTechnologies(resumeText = '', jdText = ''): string[] {
  const combined = `${resumeText}\n${jdText}`;
  const found: string[] = [];
  for (const rule of TECH_RULES) {
    if (rule.pattern.test(combined)) {
      found.push(rule.label);
    }
  }
  return Array.from(new Set(found));
}

export function extractResumeProjects(resumeText = ''): ExtractedProject[] {
  if (!resumeText.trim()) return [];

  const lines = resumeText.split('\n').map(l => l.trim());
  const projects: ExtractedProject[] = [];

  // 1. Try finding a dedicated Projects section
  const sectionHeaderRegex = /^(?:key\s+|personal\s+|academic\s+|featured\s+|selected\s+|major\s+)?projects(?:\s*[:&/].*)?$/i;
  const stopHeaderRegex = /^(?:skills|technical skills|education|experience|work experience|certifications|awards|achievements|summary|publications|languages|interests)\s*:?$/i;

  let inProjectSection = false;
  let currentName = '';
  let currentDescLines: string[] = [];

  const flushProject = () => {
    if (currentName) {
      const desc = currentDescLines.join(' ').trim();
      const techs = extractTechnologies(`${currentName} ${desc}`, '');
      projects.push({
        name: currentName,
        description: desc || 'Project referenced in candidate resume.',
        technologies: techs,
      });
    }
    currentName = '';
    currentDescLines = [];
  };

  for (const line of lines) {
    if (!line) continue;

    if (!inProjectSection) {
      if (sectionHeaderRegex.test(line) || /^(?:key\s+)?projects\s*:/i.test(line)) {
        inProjectSection = true;
      }
      continue;
    }

    if (stopHeaderRegex.test(line)) {
      flushProject();
      break;
    }

    // Numbered project title: "1. Distributed Idempotent Payment Router:" or "Project Name | React, Node"
    const numberedMatch = line.match(/^(?:\d+[.)]\s+|•\s+|-\s+)?([A-Z][^:\n]{2,75}):?\s*$/);
    const pipeMatch = line.match(/^(?:\d+[.)]\s+)?([^|\n]{3,65})\s*[|—–-]\s*(.+)$/);

    if (numberedMatch && !line.startsWith('- ') && !line.startsWith('• ')) {
      flushProject();
      currentName = numberedMatch[1].replace(/[:\-–—]+$/, '').trim();
    } else if (/^\d+[.)]\s+/.test(line)) {
      flushProject();
      const cleaned = line.replace(/^\d+[.)]\s+/, '').replace(/:$/, '').trim();
      const parts = cleaned.split(/\s*[|—–]\s*/);
      currentName = parts[0].trim();
      if (parts[1]) currentDescLines.push(parts[1].trim());
    } else if (!currentName && pipeMatch && !/^https?:/i.test(line)) {
      currentName = pipeMatch[1].trim();
      currentDescLines.push(pipeMatch[2].trim());
    } else if (currentName) {
      currentDescLines.push(line.replace(/^[-*•]\s*/, ''));
    } else {
      currentName = line.replace(/^[-*•]\s*/, '').replace(/:$/, '').trim();
    }
  }
  flushProject();

  // 2. Fallback: look for bold/capitalized engineering initiatives in experience if no Projects section found
  if (projects.length === 0) {
    const bulletProjects = lines.filter(
      l =>
        /\b(?:built|designed|architected|developed|created|implemented|led|engineered)\b/i.test(l) &&
        l.length > 25 &&
        l.length < 220
    );
    for (const bp of bulletProjects.slice(0, 3)) {
      const clean = bp.replace(/^[-*•]\s*/, '');
      const shortName = clean.split(/[.,;]/)[0].slice(0, 65).trim();
      projects.push({
        name: shortName,
        description: clean,
        technologies: extractTechnologies(clean, ''),
      });
    }
  }

  return projects.slice(0, 5);
}

export function extractJdRequirements(jdText = '', resumeText = ''): {
  requirement: string;
  status: 'matched' | 'partial' | 'missing';
  evidence: string;
  importance: 'high' | 'medium' | 'low';
}[] {
  const resumeLower = resumeText.toLowerCase();
  const jdLines = jdText
    .split('\n')
    .map(l => l.replace(/^[-*•\d.)]+\s*/, '').trim())
    .filter(l => l.length > 18 && l.length < 180 && !/^(about|responsibilities|qualifications|requirements|role|company|location)\b/i.test(l));

  const results: {
    requirement: string;
    status: 'matched' | 'partial' | 'missing';
    evidence: string;
    importance: 'high' | 'medium' | 'low';
  }[] = [];

  for (const reqLine of jdLines.slice(0, 6)) {
    const keywords = extractTechnologies(reqLine, '');
    const tokens = reqLine
      .toLowerCase()
      .replace(/[^a-z0-9+.#/\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['with', 'that', 'this', 'from', 'have', 'experience', 'strong', 'skills', 'ability', 'using', 'work', 'team', 'years', 'knowledge', 'understanding', 'build', 'design'].includes(w));

    const matchedTokens = tokens.filter(t => resumeLower.includes(t));
    const matchedTechs = keywords.filter(k => {
      const firstWord = k.split(/[\s/]/)[0].toLowerCase();
      return resumeLower.includes(firstWord);
    });

    const ratio = tokens.length > 0 ? matchedTokens.length / tokens.length : 0;
    let status: 'matched' | 'partial' | 'missing' = 'missing';
    if (matchedTechs.length > 0 && ratio >= 0.35) status = 'matched';
    else if (ratio >= 0.5) status = 'matched';
    else if (matchedTechs.length > 0 || ratio >= 0.2) status = 'partial';

    const evidenceSnippet = resumeText
      .split('\n')
      .find(rl => matchedTokens.some(t => rl.toLowerCase().includes(t)))
      ?.trim();

    results.push({
      requirement: reqLine,
      status,
      evidence:
        status === 'missing'
          ? 'No direct matching evidence found in the uploaded resume.'
          : evidenceSnippet
            ? `Matched in resume: "${evidenceSnippet.slice(0, 140)}"`
            : `Related terms detected (${matchedTokens.slice(0, 4).join(', ')}).`,
      importance: results.length < 4 ? 'high' : 'medium',
    });
  }

  return results;
}
