import json, sys, re, datetime
SR = re.compile(r'<system-reminder>.*?</system-reminder>', re.S)
def kst(ts):
    try:
        t = datetime.datetime.fromisoformat(ts.replace('Z','+00:00')) + datetime.timedelta(hours=9)
        return t.strftime('%m-%d %H:%M')
    except Exception: return '?'
def clip(s, n):
    s = s.strip()
    return s if len(s) <= n else s[:n] + f' …[+{len(s)-n}]'
def text_of(content):
    if isinstance(content, str): return content
    out = []
    for c in content or []:
        if isinstance(c, dict) and c.get('type') == 'text': out.append(c.get('text',''))
    return '\n'.join(out)
def summarize_tool(name, inp):
    if name == 'Bash': return clip(inp.get('command',''), 400)
    if name in ('Edit','Write','Read','NotebookEdit'): return inp.get('file_path','')
    if name in ('TaskCreate','TaskUpdate','TodoWrite','mcp__ccd_turn__update_plan','AskUserQuestion','Skill'):
        return clip(json.dumps(inp, ensure_ascii=False), 3000)
    if name == 'SendUserFile': return json.dumps(inp.get('files'), ensure_ascii=False) + ' ' + clip(inp.get('caption') or '', 200)
    if name.startswith('mcp__Claude_Browser'): return clip(json.dumps(inp, ensure_ascii=False), 200)
    return clip(json.dumps(inp, ensure_ascii=False), 200)
KEEP_RESULT = {'AskUserQuestion','TaskCreate','TaskUpdate','TodoWrite'}
src, dst = sys.argv[1], sys.argv[2]
pending = {}
seen_uuid = set()
with open(src) as f, open(dst, 'w') as o:
    for line in f:
        try: d = json.loads(line)
        except Exception: continue
        if d.get('uuid') in seen_uuid: continue
        if d.get('uuid'): seen_uuid.add(d['uuid'])
        t = d.get('type'); ts = kst(d.get('timestamp',''))
        msg = d.get('message') or {}
        content = msg.get('content')
        if t == 'user':
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_result':
                        nm, cmd = pending.get(c.get('tool_use_id'), ('', ''))
                        body = c.get('content')
                        body = text_of(body) if not isinstance(body, str) else body
                        if nm in KEEP_RESULT:
                            o.write(f'[{ts}] RESULT {nm}: {clip(SR.sub("", body), 1500)}\n')
                        elif nm == 'Bash' and re.search(r'git (commit|push)', cmd):
                            o.write(f'[{ts}] RESULT git: {clip(body, 300)}\n')
            txt = SR.sub('', text_of(content)).strip()
            if txt and not d.get('isMeta') and not txt.startswith('<local-command') and not txt.startswith('Caveat:'):
                o.write(f'\n[{ts}] USER: {clip(txt, 2500)}\n')
        elif t == 'assistant':
            for c in content or []:
                if not isinstance(c, dict): continue
                if c.get('type') == 'text' and c.get('text','').strip():
                    o.write(f'[{ts}] CLAUDE: {clip(c["text"], 900)}\n')
                elif c.get('type') == 'tool_use':
                    nm = c.get('name',''); inp = c.get('input') or {}
                    pending[c.get('id')] = (nm, inp.get('command','') if isinstance(inp, dict) else '')
                    o.write(f'[{ts}] TOOL {nm}: {summarize_tool(nm, inp)}\n')
