const RESUME_INSTRUCTION_PATTERN = /Resume this session with:\r?\nclaude --resume [^\r\n]+\r?\n?/g;
const ESC = String.fromCharCode(27);
const SGR_PATTERN = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');

export function sanitizeEndedReplayChunks(chunks: string[]): string[] {
  const joined = chunks.join('').replace(RESUME_INSTRUCTION_PATTERN, '');
  return [removeBackgroundSgr(joined)];
}

function removeBackgroundSgr(value: string): string {
  return value.replace(SGR_PATTERN, (_sequence, rawParams: string) => {
    const params = rawParams === '' ? ['0'] : rawParams.split(';');
    const kept: string[] = [];

    for (let index = 0; index < params.length; index++) {
      const param = Number(params[index]);
      if (isSimpleBackgroundColor(param)) continue;
      if (param === 48) {
        const mode = params[index + 1];
        if (mode === '5') {
          index += 2;
          continue;
        }
        if (mode === '2') {
          index += 4;
          continue;
        }
      }
      kept.push(params[index]);
    }

    if (kept.length === 0) return '';
    return `\x1b[${kept.join(';')}m`;
  });
}

function isSimpleBackgroundColor(param: number): boolean {
  return (param >= 40 && param <= 49) || (param >= 100 && param <= 107);
}
