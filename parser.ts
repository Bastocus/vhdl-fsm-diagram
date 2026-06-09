/**
 * VHDL FSM Parser  v0.2
 *
 * Changes vs v0.1:
 *  - Preserves original source case for all identifiers and conditions
 *  - normalised source pads comments with spaces → char offsets match originalSource
 *  - parseCaseBody is depth-aware: nested case statements no longer confuse block
 *    boundaries (fixes "missed transition inside nested case" bug)
 *  - walkTokens emits only the *innermost* (closest enclosing) if/elsif/else condition,
 *    never the full AND-chain
 *  - ELSIF replaces the top-of-stack condition rather than prepending NOT(prev)
 *  - ELSE uses the literal string "else" as the innermost condition
 */

export interface FsmState      { name: string; line: number; }
export interface FsmTransition { from: string; to: string; condition: string; line: number; }
export interface FsmSignal     { name: string; typeName: string; states: string[]; line: number; }

export interface ParsedFsm {
  signalName: string;
  typeName: string;
  states: FsmState[];
  transitions: FsmTransition[];
  entityName: string;
  architectureName: string;
}

export interface ParseResult { fsms: ParsedFsm[]; errors: string[]; }

// ── Token types ──────────────────────────────────────────────────────────────
type TokKind = 'IF' | 'ELSIF' | 'ELSE' | 'END_IF' | 'ASSIGN';

interface Token {
  kind:       TokKind;
  condition?: string;   // IF / ELSIF: condition text (original case)
  target?:    string;   // ASSIGN: destination state (original case)
  pos:        number;   // byte offset within the normalised block
}

// ── Parser ───────────────────────────────────────────────────────────────────
export class VhdlFsmParser {
  private normalised     = '';
  private originalSource = '';
  private rawLines:  string[] = [];

  parse(source: string): ParseResult {
    this.originalSource = source;
    this.rawLines       = source.split('\n');
    this.normalised     = this.buildNormalised(source);

    const result: ParseResult = { fsms: [], errors: [] };
    try {
      const entityName       = this.extractEntityName();
      const architectureName = this.extractArchitectureName();
      const enumTypes        = this.extractEnumTypes();
      const fsmSignals       = this.extractFsmSignals(enumTypes);

      for (const sig of fsmSignals) {
        const states: FsmState[] = sig.states.map(s => ({
          name: s,
          line: this.findStateLine(s),
        }));
        const transitions = this.extractTransitions(sig);
        result.fsms.push({
          signalName: sig.name,
          typeName:   sig.typeName,
          states,
          transitions,
          entityName,
          architectureName,
        });
      }
    } catch (err) {
      result.errors.push(`Parse error: ${err}`);
    }
    return result;
  }

  // ── Normalisation: lowercase + pad comments with spaces ──────────────────
  // Padding (not stripping) preserves character offsets so that
  // normalised[i] === originalSource[i].toLowerCase() for code chars,
  // making it safe to use match.index to slice from originalSource.
  private buildNormalised(source: string): string {
    return source
      .split('\n')
      .map(line => {
        const ci = line.indexOf('--');
        if (ci >= 0) {
          return line.slice(0, ci).toLowerCase() + ' '.repeat(line.length - ci);
        }
        return line.toLowerCase();
      })
      .join('\n');
  }

  // ── Entity / architecture names ──────────────────────────────────────────
  private extractEntityName(): string {
    const m = this.normalised.match(/\bentity\s+(\w+)\s+is\b/);
    return m ? this.originalAt(m.index! + m[0].indexOf(m[1]), m[1].length) : 'unknown';
  }

  private extractArchitectureName(): string {
    const m = this.normalised.match(/\barchitecture\s+(\w+)\s+of\s+\w+\s+is\b/);
    return m ? this.originalAt(m.index! + m[0].indexOf(m[1]), m[1].length) : 'rtl';
  }

  // ── Enum types ────────────────────────────────────────────────────────────
  // Run the regex on originalSource with 'gi' so captured groups are original-case.
  // Store in map as lowercase-key → original-case-values.
  private extractEnumTypes(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const re = /\btype\s+(\w+)\s+is\s*\(([^)]+)\)\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.originalSource)) !== null) {
      const typeName = m[1].trim();
      const states   = m[2].split(',').map(s => s.trim()).filter(Boolean);
      if (states.length >= 2) {
        result.set(typeName.toLowerCase(), states);   // key=lower, value=original
      }
    }
    return result;
  }

  // ── FSM signals ───────────────────────────────────────────────────────────
  private extractFsmSignals(enumTypes: Map<string, string[]>): FsmSignal[] {
    const signals: FsmSignal[] = [];
    const re = /\bsignal\s+(\w+)\s*:\s*(\w+)(?:\s*:=\s*\w+)?\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.originalSource)) !== null) {
      const sigName  = m[1].trim();
      const typeName = m[2].trim();
      if (enumTypes.has(typeName.toLowerCase())) {
        signals.push({
          name:     sigName,
          typeName,
          states:   enumTypes.get(typeName.toLowerCase())!,
          line:     this.offsetToLine(m.index),
        });
      }
    }
    return signals;
  }

  // ── Transition extraction (outer loop) ───────────────────────────────────
  private extractTransitions(sig: FsmSignal): FsmTransition[] {
    const out: FsmTransition[] = [];

    const sigNameLower  = sig.name.toLowerCase();
    const knownStates   = new Set(sig.states.map(s => s.toLowerCase()));
    // lowercase → original-case lookup for state names
    const stateOrigMap  = new Map(sig.states.map(s => [s.toLowerCase(), s]));

    // Find every "case <signal> is" in the normalised source
    const headerRe = new RegExp(`\\bcase\\s+${escapeRegex(sigNameLower)}\\s+is\\b`, 'g');
    let hm: RegExpExecArray | null;
    while ((hm = headerRe.exec(this.normalised)) !== null) {
      const bodyStart = hm.index + hm[0].length;
      const bodyEnd   = this.findMatchingEndCase(bodyStart);
      if (bodyEnd < 0) continue;

      const normBody = this.normalised.slice(bodyStart, bodyEnd);
      this.parseCaseBody(normBody, bodyStart, sigNameLower, knownStates, stateOrigMap, out);
    }
    return out;
  }

  /**
   * Walk forward from `from` in normalised, tracking `case` depth, and
   * return the index of the `end case` that closes depth 1.
   */
  private findMatchingEndCase(from: number): number {
    // Match end-case before bare case so "end case" doesn't get counted as "case"
    const re = /\bend\s+case\b|\bcase\b/g;
    re.lastIndex = from;
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.normalised)) !== null) {
      if (/^end\s+case/.test(m[0])) { if (--depth === 0) return m.index; }
      else                          { depth++; }
    }
    return -1;
  }

  // ── Case body parser (depth-aware) ────────────────────────────────────────
  /**
   * Split the case body into "when X =>" blocks, but only at depth 0.
   * Nested case statements increment depth, so their `when` keywords are skipped.
   * This fixes the missed-transition bug when a `when` block contains a nested case.
   */
  private parseCaseBody(
    normBody:    string,
    bodyOffset:  number,
    sigNameLower: string,
    knownStates:  Set<string>,
    stateOrigMap: Map<string, string>,
    out:          FsmTransition[]
  ): void {
    // Scan for: end case (depth--), case (depth++), when X => at depth 0
    const scanRe = /\bend\s+case\b|\bcase\b|\bwhen\s+(\w+)\s*=>/g;
    let depth = 0;

    interface WhenEntry {
      stateLower:   string;
      origState:    string;
      whenStart:    number;   // offset of "when" keyword in normBody
      contentStart: number;   // offset right after "=>"
    }
    const entries: WhenEntry[] = [];
    let sm: RegExpExecArray | null;

    while ((sm = scanRe.exec(normBody)) !== null) {
      const full = sm[0];
      if      (/^end\s+case/.test(full)) { if (depth > 0) depth--; }
      else if (/^case/.test(full))       { depth++; }
      else if (depth === 0 && sm[1]) {
        // "when X =>" at top level
        const stateLower = sm[1].toLowerCase();
        // Recover original case from the same position in originalSource
        const origState  = stateOrigMap.get(stateLower)
          ?? this.originalAt(bodyOffset + sm.index + full.indexOf(sm[1]), sm[1].length);
        entries.push({
          stateLower,
          origState,
          whenStart:    sm.index,
          contentStart: sm.index + full.length,
        });
      }
    }

    for (let i = 0; i < entries.length; i++) {
      const { stateLower, origState, contentStart } = entries[i];
      if (!knownStates.has(stateLower)) continue;

      const blockEnd   = i + 1 < entries.length ? entries[i + 1].whenStart : normBody.length;
      const normBlock  = normBody.slice(contentStart, blockEnd);
      const origBlock  = this.originalSource.slice(bodyOffset + contentStart, bodyOffset + blockEnd);

      this.processBlock(normBlock, origBlock, bodyOffset + contentStart,
                        origState, sigNameLower, knownStates, stateOrigMap, out);
    }
  }

  // ── Block processor ───────────────────────────────────────────────────────
  private processBlock(
    normBlock:    string,
    origBlock:    string,
    blockOffset:  number,
    fromState:    string,
    sigNameLower: string,
    knownStates:  Set<string>,
    stateOrigMap: Map<string, string>,
    out:          FsmTransition[]
  ): void {
    const tokens = this.tokeniseBlock(normBlock, origBlock, sigNameLower, knownStates, stateOrigMap);
    this.walkTokens(tokens, fromState, blockOffset, out);
  }

  // ── Tokeniser ─────────────────────────────────────────────────────────────
  /**
   * Produce a flat list of IF/ELSIF/ELSE/END_IF/ASSIGN tokens from one when-block.
   *
   * normBlock: lowercase, comment-padded (for pattern matching)
   * origBlock: original source at the same offsets (for extracting display text)
   *
   * Note: nested case/end-case tokens are intentionally ignored here.
   * Their presence doesn't break if/end-if balance because VHDL requires
   * end-if inside the case when branches, so the depths stay correct.
   */
  private tokeniseBlock(
    normBlock:    string,
    origBlock:    string,
    sigNameLower: string,
    knownStates:  Set<string>,
    stateOrigMap: Map<string, string>
  ): Token[] {
    const tokens: Token[] = [];

    // Combined pattern. end-if MUST come before bare if in the alternation.
    const masterRe = new RegExp(
      `\\bend\\s+if\\b` +
      `|\\belsif\\s+([\\s\\S]+?)\\s+then\\b` +
      `|\\belse\\b(?!\\s*\\bif\\b)` +
      `|\\bif\\s+([\\s\\S]+?)\\s+then\\b` +
      `|\\b${escapeRegex(sigNameLower)}\\s*<=\\s*(\\w+)\\s*;`,
      'g'
    );

    let m: RegExpExecArray | null;
    while ((m = masterRe.exec(normBlock)) !== null) {
      const full     = m[0];
      const pos      = m.index;
      // Slice the same span from the original (case-preserving) block
      const origFull = origBlock.slice(pos, pos + full.length);

      if (/^end\s+if/.test(full)) {
        tokens.push({ kind: 'END_IF', pos });

      } else if (/^elsif/.test(full)) {
        const cm = /^elsif\s+([\s\S]+?)\s+then$/i.exec(origFull);
        tokens.push({ kind: 'ELSIF', condition: (cm ? cm[1] : m[1] ?? '').trim(), pos });

      } else if (/^else/.test(full)) {
        tokens.push({ kind: 'ELSE', pos });

      } else if (/^if/.test(full)) {
        const cm = /^if\s+([\s\S]+?)\s+then$/i.exec(origFull);
        tokens.push({ kind: 'IF', condition: (cm ? cm[1] : m[2] ?? '').trim(), pos });

      } else {
        // Assignment: sigName <= targetState ;
        // Extract target from origFull to preserve case
        const assignRe = new RegExp(`^${escapeRegex(sigNameLower)}\\s*<=\\s*(\\w+)\\s*;`, 'i');
        const cm = assignRe.exec(origFull);
        const target = cm ? cm[1].trim() : (m[3] ?? '').trim();
        if (target && knownStates.has(target.toLowerCase())) {
          // Resolve to original-case state name
          tokens.push({
            kind:   'ASSIGN',
            target: stateOrigMap.get(target.toLowerCase()) ?? target,
            pos,
          });
        }
      }
    }
    return tokens;
  }

  // ── Token walker – emits innermost condition only ─────────────────────────
  /**
   * Walk the flat token list with a condition stack.
   * condStack[top] = the condition of the *immediately* enclosing if/elsif/else.
   *
   * On ASSIGN we emit condStack[top] (not a join of the whole stack), which
   * satisfies requirement 1: "show only the innermost condition".
   *
   * ELSIF replaces the top entry (new condition only, no NOT(prev) prefix).
   * ELSE  replaces the top entry with the string "else".
   */
  private walkTokens(
    tokens:      Token[],
    fromState:   string,
    blockOffset: number,
    out:         FsmTransition[]
  ): void {
    const condStack: string[] = [];

    for (const tok of tokens) {
      switch (tok.kind) {
        case 'IF':
          condStack.push(this.fmtCond(tok.condition ?? ''));
          break;

        case 'ELSIF':
          // Replace top with just this new condition (innermost only)
          if (condStack.length > 0) {
            condStack[condStack.length - 1] = this.fmtCond(tok.condition ?? '');
          } else {
            condStack.push(this.fmtCond(tok.condition ?? ''));
          }
          break;

        case 'ELSE':
          // The direct cause of this branch is "else"; no condition expression
          if (condStack.length > 0) {
            condStack[condStack.length - 1] = 'else';
          }
          break;

        case 'END_IF':
          condStack.pop();
          break;

        case 'ASSIGN': {
          // Innermost condition = top of stack; empty stack = unconditional
          const cond = condStack.length > 0 ? condStack[condStack.length - 1] : '(always)';
          const line = this.offsetToLine(blockOffset + tok.pos);

          const dup = out.some(t =>
            t.from === fromState && t.to === tok.target! && t.condition === cond
          );
          if (!dup) {
            out.push({ from: fromState, to: tok.target!, condition: cond, line });
          }
          break;
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Normalise whitespace in a condition string; preserve original case. */
  private fmtCond(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
  }

  /** Extract text from originalSource at [offset, offset+length). */
  private originalAt(offset: number, length: number): string {
    return this.originalSource.slice(offset, offset + length);
  }

  /** Convert a byte offset in normalised/originalSource to a 1-based line number. */
  private offsetToLine(offset: number): number {
    return this.normalised.slice(0, offset).split('\n').length;
  }

  /** Find the first line containing stateName (original case, case-insensitive). */
  private findStateLine(name: string): number {
    const lo = name.toLowerCase();
    for (let i = 0; i < this.rawLines.length; i++) {
      const ci = this.rawLines[i].indexOf('--');
      const line = ci >= 0 ? this.rawLines[i].slice(0, ci) : this.rawLines[i];
      if (line.toLowerCase().includes(lo)) return i + 1;
    }
    return 1;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
