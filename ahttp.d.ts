declare namespace Ahttp {
  type AccessMode = 'public' | 'dev' | 'gate' | 'owner';
  type Region = 'modal' | 'main' | 'chrome';
  type Format = 'text' | 'json';

  interface SnapshotOptions {
    format?: Format;
    scope?: string;
    query?: string;
    maxActions?: number;
    maxText?: number;
    includeText?: boolean;
    interactiveOnly?: boolean;
    force?: boolean;
    group?: boolean;
    compact?: boolean;
    verbose?: boolean;
  }

  interface Action {
    id: string;
    tag: string;
    role: string;
    kind: string;
    label: string;
    region: Region;
    type?: string;
    name?: string;
    href?: string;
    placeholder?: string;
    value?: string;
    checked?: boolean;
    options?: string[];
    optionCount?: number;
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    editable?: boolean;
    intent?: string;
    requiresConfirmation?: boolean;
    warning?: string;
  }

  interface SnapshotMeta {
    version: string;
    actions: number;
    shown: number;
    omitted: number;
    groups: number;
    textLines: number;
    forms: number;
    controls: number;
    nodes: number;
    sanitized: number;
    ignored: number;
    shadowRoots: number;
    truncated: boolean;
    layout: string;
    ms: number;
    scanMs: number;
    query: string | null;
    scope: string | null;
    textTrust: 'untrusted';
    includeText: boolean;
    chars?: number;
    tokens?: number;
    owner?: string | null;
    policyHidden?: number;
    policyReadOnly?: boolean;
    missingScope?: string;
    [key: string]: unknown;
  }

  interface Snapshot {
    version: string;
    url: string;
    title: string;
    locked: boolean;
    owner: string | null;
    modal: boolean;
    layout: string;
    regions: Record<Region, number>;
    actions: Action[];
    text: string[];
    textTrust: 'untrusted';
    meta: SnapshotMeta;
  }

  interface LockedSnapshot {
    version: string;
    locked: true;
    access: AccessMode | string;
    owner: string | null;
    error: string;
    actions: [];
    text: [];
    meta: Record<string, unknown>;
  }

  interface ActPayload {
    value?: string;
    checked?: boolean;
    read?: boolean;
    key?: string;
    hover?: boolean;
    scroll?: boolean;
    confirm?: boolean;
    settle?: boolean;
    timeout?: number;
    quiet?: number;
    minWait?: number;
    networkQuiet?: number;
    diff?: boolean;
    snapshot?: boolean;
    maxActions?: number;
  }

  interface Diff {
    added: Array<Partial<Action>>;
    removed: Array<Partial<Action>>;
    changed: Array<Record<string, unknown>>;
    textAdded: string[];
    textRemoved: string[];
    modal: Record<string, unknown> | null;
    url: { from: string; to: string } | null;
    empty: boolean;
    summary: string;
    text: string;
  }

  interface ActResult {
    ok: boolean;
    action?: Record<string, unknown>;
    method?: string;
    url?: string;
    latencyMs?: number;
    diff?: Diff;
    snapshot?: string;
    snapshotMeta?: { chars: number; tokens: number };
    meta?: { mutations: number; requests: number; settleMs: number };
    error?: string;
    blocked?: boolean;
    locked?: boolean;
    requiresConfirmation?: boolean;
    warning?: string;
    id?: string;
    value?: string | boolean;
    checked?: boolean;
    readonly?: boolean;
    readOnly?: boolean;
    available?: string[];
    selected?: string;
    href?: string;
    message?: string;
    reason?: string | null;
  }

  interface PolicySummary {
    owner: string | null;
    access: AccessMode | string;
    private: boolean;
    readOnly: boolean;
    maxActions: number | null;
    allow: string[];
    deny: string[];
    confirm: string[];
    serverAuth: boolean;
    authTimeoutMs: number | null;
    keyConfigured: boolean;
    keyHashConfigured: boolean;
    insecurePlaintextKey: boolean;
    clientSideGateOnly: boolean;
    softGateOnly: boolean;
  }

  interface Status {
    state: 'dormant' | 'active';
    version: string;
    dormant: boolean;
    wakeCount: number;
    wakeMs: number;
    mode: AccessMode | string;
    access: AccessMode | string;
    locked: boolean;
    lockedReason: string | null;
    owner: string | null;
    authMode: string;
    authExpiresAt: number | null;
    serverVerified: boolean;
    warnings: string[];
    policy: PolicySummary | null;
    engine: 'idle' | 'active';
    overhead?: string;
    actions: number;
    nodes: number;
    sanitized: number;
    layout?: string;
    forms?: number;
    ignored?: number;
    policyHidden?: number;
    observers?: number;
    network?: { patched: boolean; requests: number; inflight: number };
    scanMs?: number;
    lastLatencyMs?: number;
    uptimeMs?: number;
  }

  interface UnlockResult {
    ok: boolean;
    locked: boolean;
    mode?: string;
    owner?: string | null;
    error?: string;
    retryAfterMs?: number;
  }

  interface AuthorizeResult {
    ok: boolean;
    locked: boolean;
    mode?: string;
    owner?: string | null;
    expiresAt?: number;
    error?: string;
    status?: number;
    message?: string;
  }

  interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }

  interface ToolsResult {
    version: string;
    locked?: boolean;
    access?: string | null;
    owner?: string | null;
    error?: string;
    tools: ToolDefinition[];
    actions: Array<Partial<Action>>;
    snapshotMeta?: SnapshotMeta;
    url?: string;
    generatedAt?: string;
  }

  interface ConfigureOptions {
    owner?: string;
    access?: AccessMode;
    private?: boolean;
    key?: string;
    keyHash?: string;
    authEndpoint?: string;
    authTimeoutMs?: number;
    authorizeAction?: (action: Record<string, unknown>) => boolean | { ok: boolean; reason?: string } | Promise<boolean | { ok: boolean; reason?: string }>;
    allow?: string[] | string;
    deny?: string[] | string;
    confirm?: string[] | string;
    readOnly?: boolean;
    maxActions?: number;
  }

  interface WebMCPInstallResult {
    ok: boolean;
    names?: string[];
    close?: () => void;
    error?: string;
    message?: string;
  }

  interface AhttpApi {
    __ahttp: true;
    version: string;
    wake(): Status;
    snapshot(options?: SnapshotOptions & { format?: 'text' }): string;
    snapshot(options: SnapshotOptions & { format: 'json' }): Snapshot | LockedSnapshot;
    snapshot(options?: SnapshotOptions): string | Snapshot | LockedSnapshot;
    act(id: string, payload?: string | ActPayload | null, options?: ActPayload): Promise<ActResult>;
    tools(): ToolsResult;
    status(): Status;
    sleep(): { state: 'dormant'; restored: boolean; observers: number; locked: boolean };
    configure(options: ConfigureOptions): PolicySummary | null;
    unlock(key: string): UnlockResult;
    authorize(options?: { token?: string; key?: string }): Promise<AuthorizeResult>;
    lock(): Status;
    hashKey(value: string): string;
    installWebMCP(options?: { prefix?: string }): Promise<WebMCPInstallResult>;
  }
}

declare const ahttp: Ahttp.AhttpApi;
export = ahttp;
