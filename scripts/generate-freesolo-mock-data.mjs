import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "training/freesolo/environment/dataset");

const systemInstruction = [
  "Normalize one pull-request review episode into the Engineering Memory SemanticAnalysis v2 schema.",
  "Use only the supplied evidence and return raw JSON without Markdown. Return exactly: intent,",
  "title, rule, rationale, detection. intent must be one of",
  "actionable-change, architecture, testing, security, style, question-nonactionable. Signals must",
  "be exact code substrings, never English descriptions. detection contains mode, semanticDescription,",
  "triggerSignals, forbiddenSignals, requiredSignals, matchScope. Use forbidden-signal when code is",
  "disallowed in the trigger context, missing-required-signal when the trigger requires absent code,",
  "and semantic only when deterministic signals cannot represent the condition. Use codeContext to",
  "understand the enclosing symbol and imports, but do not invent repository facts. When acceptedCode",
  "adds a guard, middleware, wrapper, modifier, await, mock, or helper missing from rejectedCode, use",
  "missing-required-signal; keep forbiddenSignals empty and never mark the trigger itself forbidden.",
  "The application derives legacy preferredSignals and prohibitedSignals; do not return them. Use forbidden-signal only",
  "when acceptedCode removes or replaces a disallowed construct. Prefer the smallest reusable exact",
  "substring over an entire code line. Treat feature flags as architecture/release-control conventions.",
  "The rule must synthesize reusable, normative engineering knowledge from the comment plus code and path context.",
  "Do not quote or lightly paraphrase reviewComment. Resolve this, it, and here; name the applicable code scope;",
  "state an invariant independent of this PR; and do not mention the reviewer or end actionable rules as questions.",
].join(" ");

function semanticDetection(description) {
  return { mode: "semantic", semanticDescription: description, triggerSignals: [], forbiddenSignals: [], requiredSignals: [], matchScope: "line" };
}

function forbiddenDetection(description, forbiddenSignals, triggerSignals = [], matchScope = "line") {
  return { mode: "forbidden-signal", semanticDescription: description, triggerSignals, forbiddenSignals, requiredSignals: [], matchScope };
}

function requiredDetection(description, triggerSignals, requiredSignals, matchScope = "line") {
  return { mode: "missing-required-signal", semanticDescription: description, triggerSignals, forbiddenSignals: [], requiredSignals, matchScope };
}

function languageFromPath(filePath) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", go: "go" })[extension] ?? extension ?? "unknown";
}

function mockCodeContext(input) {
  const reviewedContext = input.rejectedCode.includes("\n")
    ? input.rejectedCode
    : `function reviewedSymbol() {\n  ${input.rejectedCode}\n}`;
  const acceptedContext = input.acceptedCode
    ? (input.acceptedCode.includes("\n") ? input.acceptedCode : `function reviewedSymbol() {\n  ${input.acceptedCode}\n}`)
    : undefined;
  return {
    source: "historical-file",
    language: languageFromPath(input.filePath),
    commentLine: 2,
    enclosingSymbol: { name: "reviewedSymbol", kind: "function", startLine: 1, endLine: 3 },
    imports: [],
    reviewedContext,
    ...(acceptedContext ? { acceptedContext } : {}),
    truncated: false,
  };
}

function row(input, output, detection) {
  const resolvedDetection = detection ?? (
    output.intent === "question-nonactionable" || output.prohibitedSignals.length === 0
      ? semanticDetection(output.rule)
      : forbiddenDetection(output.rule, output.prohibitedSignals)
  );
  return {
    input: JSON.stringify({
      task: "analyze_review_episode",
      version: "2",
      instruction: systemInstruction,
      episode: { ...input, codeContext: input.codeContext ?? mockCodeContext(input) },
    }),
    output: JSON.stringify({
      intent: output.intent,
      title: output.title,
      rule: output.rule,
      rationale: output.rationale,
      detection: resolvedDetection,
    }),
  };
}

const train = [
  row(
    { repository: "acme/api", pullRequest: 142, filePath: "src/controllers/order.ts", reviewComment: "Please move this Prisma call into the service layer.", rejectedCode: "return prisma.order.create({ data })", acceptedCode: "return orderService.create(data)" },
    { intent: "architecture", title: "Keep Prisma out of controllers", rule: "Controllers must delegate persistence to services instead of accessing Prisma directly.", rationale: "The accepted code moves database access from the controller into the order service.", prohibitedSignals: ["prisma.order.create"], preferredSignals: ["orderService.create"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 207, filePath: "src/controllers/invoice.ts", reviewComment: "Controllers shouldn't talk to Prisma directly.", rejectedCode: "const invoice = await prisma.invoice.findUnique({ where: { id } })", acceptedCode: "const invoice = await invoiceService.getById(id)" },
    { intent: "architecture", title: "Keep Prisma out of controllers", rule: "Controllers must use the service layer rather than calling Prisma directly.", rationale: "The accepted implementation replaces controller-level persistence with a service call.", prohibitedSignals: ["prisma.invoice.findUnique"], preferredSignals: ["invoiceService.getById"] },
  ),
  row(
    { repository: "acme/web", pullRequest: 81, filePath: "src/pages/Orders.tsx", reviewComment: "Use React Query here instead of fetching in an effect.", rejectedCode: "useEffect(() => { fetch('/api/orders').then(setOrders) }, [])", acceptedCode: "const { data: orders } = useQuery({ queryKey: ['orders'], queryFn: getOrders })" },
    { intent: "architecture", title: "Use React Query for server state", rule: "React components must use React Query rather than fetching server state in useEffect.", rationale: "The accepted implementation delegates server-state fetching and caching to React Query.", prohibitedSignals: ["useEffect", "fetch"], preferredSignals: ["useQuery", "getOrders"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 214, filePath: "src/routes/users.ts", reviewComment: "This business logic belongs in userService, not the route.", rejectedCode: "router.post('/users', async (req, res) => { const normalized = normalizeUser(req.body); await saveUser(normalized) })", acceptedCode: "router.post('/users', async (req, res) => res.json(await userService.create(req.body)))" },
    { intent: "architecture", title: "Keep business logic out of routes", rule: "Route handlers must delegate business logic to services.", rationale: "The accepted route delegates normalization and persistence to userService.", prohibitedSignals: ["normalizeUser", "saveUser"], preferredSignals: ["userService.create"] },
  ),
  row(
    { repository: "acme/web", pullRequest: 90, filePath: "src/components/Profile.test.tsx", reviewComment: "Mock GraphQL in this unit test; don't call the real API.", rejectedCode: "render(<Profile apiUrl={process.env.API_URL} />)", acceptedCode: "server.use(graphql.query('Profile', profileHandler)); render(<Profile />)" },
    { intent: "testing", title: "Mock GraphQL in unit tests", rule: "Unit tests must mock GraphQL operations rather than calling a live API.", rationale: "The accepted test installs a GraphQL mock handler before rendering the component.", prohibitedSignals: ["process.env.API_URL"], preferredSignals: ["server.use", "graphql.query"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 231, filePath: "src/services/order.test.ts", reviewComment: "Unit tests should use the repository mock, not the real database.", rejectedCode: "const db = new PrismaClient()", acceptedCode: "const repository = createOrderRepositoryMock()" },
    { intent: "testing", title: "Mock repositories in unit tests", rule: "Unit tests must use repository mocks instead of creating real database clients.", rationale: "The accepted test replaces PrismaClient with the order repository mock.", prohibitedSignals: ["PrismaClient"], preferredSignals: ["createOrderRepositoryMock"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 238, filePath: "src/lib/pagination.test.ts", reviewComment: "Please add coverage for an empty result set.", rejectedCode: "expect(paginate([item], 1)).toEqual([item])", acceptedCode: "expect(paginate([], 1)).toEqual([])" },
    { intent: "testing", title: "Test empty pagination results", rule: "Pagination behavior must be tested with an empty result set.", rationale: "The accepted test adds the missing empty-collection case requested by the reviewer.", prohibitedSignals: [], preferredSignals: ["paginate"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 250, filePath: "src/routes/export.ts", reviewComment: "Every public endpoint needs the auth middleware.", rejectedCode: "router.get('/export', exportController)", acceptedCode: "router.get('/export', requireAuth, exportController)" },
    { intent: "security", title: "Authenticate public endpoints", rule: "Public endpoints must apply the repository authentication middleware.", rationale: "The accepted route adds requireAuth before invoking the controller.", prohibitedSignals: [], preferredSignals: ["requireAuth"] },
    requiredDetection("A public endpoint is defined without authentication middleware.", ["exportController"], ["requireAuth"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 101, filePath: "src/components/Bio.tsx", reviewComment: "This renders user HTML; sanitize it before passing it to dangerouslySetInnerHTML.", rejectedCode: "<div dangerouslySetInnerHTML={{ __html: bio }} />", acceptedCode: "<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(bio) }} />" },
    { intent: "security", title: "Sanitize user-provided HTML", rule: "User-provided HTML must be sanitized before it is rendered.", rationale: "The accepted code sanitizes the biography before using dangerouslySetInnerHTML.", prohibitedSignals: [], preferredSignals: ["sanitizeHtml"] },
    requiredDetection("User-provided HTML is rendered without sanitization.", ["dangerouslySetInnerHTML"], ["sanitizeHtml"]),
  ),
  row(
    { repository: "acme/platform", pullRequest: 44, filePath: "src/auth/token.ts", reviewComment: "Never log an access token, even at debug level.", rejectedCode: "logger.debug('token issued', { token })", acceptedCode: "logger.debug('token issued', { userId })" },
    { intent: "security", title: "Do not log access tokens", rule: "Access tokens and other credentials must never be written to logs.", rationale: "The accepted implementation records a non-secret identifier instead of the token.", prohibitedSignals: ["token"], preferredSignals: ["userId"] },
    forbiddenDetection("An access token is passed to a logger.", ["token"], ["logger.debug"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 267, filePath: "src/services/user.ts", reviewComment: "Rename `x` to describe what it contains.", rejectedCode: "const x = await repository.findById(id)", acceptedCode: "const user = await repository.findById(id)" },
    { intent: "style", title: "Use descriptive local names", rule: "Local variables should communicate the value they contain.", rationale: "The accepted code replaces an opaque variable name with the domain value name.", prohibitedSignals: ["x"], preferredSignals: ["user"] },
    semanticDetection("A local variable name does not describe the value it contains."),
  ),
  row(
    { repository: "acme/web", pullRequest: 118, filePath: "src/components/OrderCard.tsx", reviewComment: "Nit: use the formatter instead of assembling the currency string here.", rejectedCode: "`${currency} ${amount.toFixed(2)}`", acceptedCode: "formatCurrency(amount, currency)" },
    { intent: "style", title: "Use the shared currency formatter", rule: "Currency values should be rendered with the shared formatCurrency helper.", rationale: "The accepted code replaces local string assembly with the repository formatter.", prohibitedSignals: ["toFixed"], preferredSignals: ["formatCurrency"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 275, filePath: "src/controllers/orders.ts", reviewComment: "The list endpoint must use the shared pagination helper.", rejectedCode: "const rows = orders.slice(offset, offset + limit)", acceptedCode: "const rows = paginate(orders, { offset, limit })" },
    { intent: "actionable-change", title: "Use shared endpoint pagination", rule: "List endpoints must use the shared pagination helper.", rationale: "The accepted implementation replaces local slicing with the repository pagination utility.", prohibitedSignals: ["slice"], preferredSignals: ["paginate"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 281, filePath: "src/controllers/payment.ts", reviewComment: "Map this failure through toApiError so clients get our standard response shape.", rejectedCode: "catch (error) { res.status(500).json({ message: error.message }) }", acceptedCode: "catch (error) { next(toApiError(error)) }" },
    { intent: "actionable-change", title: "Use standard API error mapping", rule: "Controller failures must be passed through the shared API error mapper.", rationale: "The accepted implementation delegates error translation to toApiError.", prohibitedSignals: ["res.status"], preferredSignals: ["toApiError"] },
  ),
  row(
    { repository: "acme/platform", pullRequest: 52, filePath: "src/jobs/sync.ts", reviewComment: "Await this write before marking the job complete.", rejectedCode: "repository.save(result); return complete()", acceptedCode: "await repository.save(result); return complete()" },
    { intent: "actionable-change", title: "Await writes before job completion", rule: "Asynchronous persistence must finish before a job is marked complete.", rationale: "The accepted code awaits the repository write before returning completion.", prohibitedSignals: [], preferredSignals: ["await repository.save"] },
    requiredDetection("A repository write is started without awaiting its completion.", ["repository.save"], ["await repository.save"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 290, filePath: "src/factories/order.ts", reviewComment: "Why is this factory responsible for sending the notification?", rejectedCode: "await notifier.send(order)", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Define notification ownership", rule: "Notification ownership between this factory and downstream services is not established and requires an architectural decision.", rationale: "The comment is a question and no accepted replacement demonstrates a required convention.", prohibitedSignals: [], preferredSignals: [] },
  ),
  row(
    { repository: "acme/web", pullRequest: 126, filePath: "src/cache/profile.ts", reviewComment: "How does this cache get invalidated?", rejectedCode: "profileCache.set(userId, profile)", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Define cache invalidation behavior", rule: "Cache invalidation behavior for this operation is not documented and must be defined before it can be enforced.", rationale: "The comment requests an explanation and supplies no accepted code change.", prohibitedSignals: [], preferredSignals: [] },
  ),
  row(
    { repository: "acme/platform", pullRequest: 61, filePath: "src/config/loader.ts", reviewComment: "Could you explain why this configuration is loaded twice?", rejectedCode: "loadConfig(); initialize(); loadConfig()", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Define configuration loading policy", rule: "The repository must define whether duplicate configuration loading is intentional before enforcing a single-loading policy.", rationale: "The evidence does not establish a requested or accepted engineering convention.", prohibitedSignals: [], preferredSignals: [] },
  ),
];

const evaluation = [
  row(
    { repository: "acme/api", pullRequest: 310, filePath: "src/routes/reports.ts", reviewComment: "New public endpoints must be guarded by a feature flag.", rejectedCode: "router.get('/reports', requireAuth, reportsController)", acceptedCode: "router.get('/reports', requireAuth, requireFeature('reports'), reportsController)" },
    { intent: "architecture", title: "Feature-flag new public endpoints", rule: "New public endpoints must be protected by the appropriate feature flag.", rationale: "The accepted route adds the reports feature gate before the controller.", prohibitedSignals: [], preferredSignals: ["requireFeature"] },
    requiredDetection("A new public endpoint is defined without its feature gate.", ["reportsController"], ["requireFeature"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 318, filePath: "src/services/checkout.ts", reviewComment: "These writes need to happen in one transaction.", rejectedCode: "await orderRepository.save(order); await paymentRepository.save(payment)", acceptedCode: "await database.transaction(async (tx) => { await orderRepository.save(order, tx); await paymentRepository.save(payment, tx) })" },
    { intent: "architecture", title: "Use transactions for coupled writes", rule: "Writes that must succeed together must run in one database transaction.", rationale: "The accepted implementation wraps the order and payment writes in a shared transaction.", prohibitedSignals: [], preferredSignals: ["database.transaction"] },
    requiredDetection("Coupled persistence writes occur without a shared transaction.", ["orderRepository.save", "paymentRepository.save"], ["database.transaction"], "file"),
  ),
  row(
    { repository: "acme/platform", pullRequest: 70, filePath: "src/jobs/expiry.test.ts", reviewComment: "Mock the clock so this test doesn't depend on wall time.", rejectedCode: "expect(isExpired(new Date())).toBe(false)", acceptedCode: "vi.setSystemTime(fixedNow); expect(isExpired(new Date())).toBe(false)" },
    { intent: "testing", title: "Control time in unit tests", rule: "Time-dependent unit tests must use a fixed mocked clock.", rationale: "The accepted test fixes system time before evaluating expiration behavior.", prohibitedSignals: [], preferredSignals: ["vi.setSystemTime"] },
    requiredDetection("A time-dependent test uses wall time without fixing the clock.", ["isExpired"], ["vi.setSystemTime"], "file"),
  ),
  row(
    { repository: "acme/web", pullRequest: 139, filePath: "src/routes/settings.ts", reviewComment: "State-changing browser routes require CSRF protection.", rejectedCode: "router.post('/settings', updateSettings)", acceptedCode: "router.post('/settings', verifyCsrf, updateSettings)" },
    { intent: "security", title: "Protect state-changing routes from CSRF", rule: "State-changing browser routes must apply CSRF verification.", rationale: "The accepted route adds verifyCsrf before the settings handler.", prohibitedSignals: [], preferredSignals: ["verifyCsrf"] },
    requiredDetection("A state-changing route is defined without CSRF verification.", ["updateSettings"], ["verifyCsrf"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 145, filePath: "src/hooks/useOrders.ts", reviewComment: "Boolean names should read as predicates; rename `loading` to `isLoading`.", rejectedCode: "const loading = query.status === 'loading'", acceptedCode: "const isLoading = query.status === 'loading'" },
    { intent: "style", title: "Name booleans as predicates", rule: "Boolean variables should use predicate-style names such as isLoading.", rationale: "The accepted code renames the boolean to communicate its predicate meaning.", prohibitedSignals: ["loading"], preferredSignals: ["isLoading"] },
    semanticDetection("A boolean variable does not use a predicate-style name."),
  ),
  row(
    { repository: "acme/api", pullRequest: 325, filePath: "src/lib/retry.ts", reviewComment: "What happens when all retry attempts fail?", rejectedCode: "return retry(operation, 3)", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Define exhausted-retry behavior", rule: "The repository must define the failure behavior after retry attempts are exhausted.", rationale: "The comment asks for clarification and provides no accepted implementation change.", prohibitedSignals: [], preferredSignals: [] },
  ),
];

// Held-out cases intentionally vary domains, languages, and detection modes.
// They are never included in training and prevent us from selecting a model
// merely because it memorized the starter examples.
const additionalEvaluation = [
  row(
    { repository: "acme/api", pullRequest: 501, filePath: "src/controllers/subscriptions.ts", reviewComment: "Controllers should not query the database client directly; delegate to the subscription service.", rejectedCode: "return db.subscription.findMany({ where: { userId } })", acceptedCode: "return subscriptionService.listForUser(userId)" },
    { intent: "architecture", title: "Keep database access out of subscription controllers", rule: "Subscription controllers must delegate persistence to the subscription service.", rationale: "The accepted implementation replaces controller-level database access with a service call.", prohibitedSignals: ["db.subscription.findMany"], preferredSignals: ["subscriptionService.listForUser"] },
    forbiddenDetection("A subscription controller queries the database client directly.", ["db.subscription.findMany"]),
  ),
  row(
    { repository: "acme/platform", pullRequest: 502, filePath: "src/audit/login.ts", reviewComment: "Never include passwords in structured logs.", rejectedCode: "audit.info('login failed', { email, password })", acceptedCode: "audit.info('login failed', { email })" },
    { intent: "security", title: "Do not log passwords", rule: "Passwords must never be included in structured log fields.", rationale: "The accepted log removes the password while preserving non-secret diagnostic context.", prohibitedSignals: ["password"], preferredSignals: [] },
    forbiddenDetection("A password is included in a structured audit log.", ["password"], ["audit.info"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 503, filePath: "src/pages/Projects.tsx", reviewComment: "Use the project query hook instead of fetching server state in an effect.", rejectedCode: "useEffect(() => { fetch('/api/projects').then(loadProjects) }, [])", acceptedCode: "const projects = useProjectsQuery()" },
    { intent: "architecture", title: "Use the project query hook", rule: "Project pages must use the repository query hook for server state.", rationale: "The accepted component replaces effect-based fetching with the project query hook.", prohibitedSignals: ["useEffect", "fetch"], preferredSignals: ["useProjectsQuery"] },
    forbiddenDetection("A project page fetches server state inside useEffect.", ["useEffect", "fetch"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 504, filePath: "src/routes/documents.ts", reviewComment: "Document downloads must run the document-access middleware first.", rejectedCode: "router.get('/documents/:id', downloadDocument)", acceptedCode: "router.get('/documents/:id', requireDocumentAccess, downloadDocument)" },
    { intent: "security", title: "Authorize document downloads", rule: "Document download routes must apply document-access authorization.", rationale: "The accepted route adds requireDocumentAccess before the download handler.", prohibitedSignals: [], preferredSignals: ["requireDocumentAccess"] },
    requiredDetection("A document download route lacks document-access authorization.", ["downloadDocument"], ["requireDocumentAccess"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 505, filePath: "src/services/refunds.ts", reviewComment: "The refund and ledger writes must commit together.", rejectedCode: "await refunds.save(refund); await ledger.append(entry)", acceptedCode: "await database.transaction(async tx => { await refunds.save(refund, tx); await ledger.append(entry, tx) })" },
    { intent: "architecture", title: "Make refund writes transactional", rule: "Refund and ledger writes must execute in one database transaction.", rationale: "The accepted implementation wraps both coupled writes in a shared transaction.", prohibitedSignals: [], preferredSignals: ["database.transaction"] },
    requiredDetection("Coupled refund and ledger writes occur without a shared transaction.", ["refunds.save", "ledger.append"], ["database.transaction"], "file"),
  ),
  row(
    { repository: "acme/platform", pullRequest: 506, filePath: "src/jobs/archive.ts", reviewComment: "Await the upload before reporting archive completion.", rejectedCode: "archiveStore.upload(bundle); return completed()", acceptedCode: "await archiveStore.upload(bundle); return completed()" },
    { intent: "actionable-change", title: "Await archive uploads", rule: "Archive uploads must finish before the job reports completion.", rationale: "The accepted job awaits the upload before returning completion.", prohibitedSignals: [], preferredSignals: ["await archiveStore.upload"] },
    requiredDetection("An archive upload is started without awaiting completion.", ["archiveStore.upload"], ["await archiveStore.upload"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 507, filePath: "src/components/Status.tsx", reviewComment: "Name this boolean like a predicate: `isReady`.", rejectedCode: "const ready = status === 'ready'", acceptedCode: "const isReady = status === 'ready'" },
    { intent: "style", title: "Use predicate names for readiness booleans", rule: "Readiness booleans should use predicate-style names.", rationale: "The accepted code renames the boolean to isReady.", prohibitedSignals: ["ready"], preferredSignals: ["isReady"] },
    semanticDetection("A readiness boolean does not use a predicate-style name."),
  ),
  row(
    { repository: "acme/api", pullRequest: 508, filePath: "src/cache/catalog.ts", reviewComment: "How is the catalog cache invalidated after an import?", rejectedCode: "catalogCache.set(key, catalog)", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Define catalog cache invalidation", rule: "Catalog import cache invalidation behavior must be explicitly defined before it can be enforced.", rationale: "The comment asks for clarification and provides no accepted implementation change.", prohibitedSignals: [], preferredSignals: [] },
  ),
  row(
    { repository: "acme/web", pullRequest: 509, filePath: "src/search/results.ts", reviewComment: "Should empty searches return everything, or should we document this behavior?", rejectedCode: "if (!query) return allResults", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Define empty-search behavior", rule: "The search API must explicitly define and document the result of an empty query.", rationale: "No accepted implementation establishes an executable repository convention.", prohibitedSignals: [], preferredSignals: [] },
  ),
];

const additionalExecutable = [
  row(
    { repository: "acme/api", pullRequest: 401, filePath: "src/controllers/account.py", reviewComment: "Views must not query the session directly; use AccountService.", rejectedCode: "account = db.session.query(Account).get(account_id)", acceptedCode: "account = account_service.get(account_id)" },
    { intent: "architecture", title: "Keep database sessions out of views", rule: "HTTP views must delegate persistence to services.", rationale: "The accepted view delegates account lookup to the service.", prohibitedSignals: ["db.session.query"], preferredSignals: ["account_service.get"] },
  ),
  row(
    { repository: "acme/web", pullRequest: 402, filePath: "src/pages/Teams.tsx", reviewComment: "Server state should use React Query rather than fetch in an effect.", rejectedCode: "useEffect(() => { fetch('/api/teams').then(loadTeams) }, [])", acceptedCode: "const teams = useQuery({ queryKey: ['teams'], queryFn: getTeams })" },
    { intent: "architecture", title: "Use React Query for teams", rule: "Components must use React Query for server state.", rationale: "The accepted component replaces effect-based fetching with useQuery.", prohibitedSignals: ["useEffect", "fetch"], preferredSignals: ["useQuery"] },
  ),
  row(
    { repository: "acme/platform", pullRequest: 403, filePath: "src/auth/session.ts", reviewComment: "Do not log session secrets.", rejectedCode: "logger.info('session created', { sessionToken })", acceptedCode: "logger.info('session created', { sessionId })" },
    { intent: "security", title: "Do not log session tokens", rule: "Session tokens must not be written to logs.", rationale: "The accepted log uses a non-secret session identifier.", prohibitedSignals: ["sessionToken"], preferredSignals: ["sessionId"] },
    forbiddenDetection("A session token is passed to a logger.", ["sessionToken"], ["logger.info"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 404, filePath: "src/repositories/user.py", reviewComment: "Do not build SQL by concatenating the user ID.", rejectedCode: "cursor.execute('SELECT * FROM users WHERE id=' + user_id)", acceptedCode: "cursor.execute('SELECT * FROM users WHERE id=%s', (user_id,))" },
    { intent: "security", title: "Parameterize SQL queries", rule: "Repository queries must use bound SQL parameters.", rationale: "The accepted query binds the user identifier separately.", prohibitedSignals: ["+ user_id"], preferredSignals: ["%s"] },
  ),
  row(
    { repository: "acme/platform", pullRequest: 405, filePath: "Dockerfile", reviewComment: "Pin the runtime image instead of using latest.", rejectedCode: "FROM node:latest", acceptedCode: "FROM node:22.4-alpine" },
    { intent: "architecture", title: "Pin runtime image versions", rule: "Production container images must use an explicit version.", rationale: "The accepted Dockerfile replaces latest with a pinned runtime version.", prohibitedSignals: ["node:latest"], preferredSignals: ["node:22.4-alpine"] },
  ),
  row(
    { repository: "acme/api", pullRequest: 406, filePath: "src/routes/admin.ts", reviewComment: "Admin routes require the admin authorization middleware.", rejectedCode: "router.get('/admin', adminController)", acceptedCode: "router.get('/admin', requireAdmin, adminController)" },
    { intent: "security", title: "Authorize admin routes", rule: "Administrative routes must apply admin authorization middleware.", rationale: "The accepted route adds requireAdmin before the controller.", prohibitedSignals: [], preferredSignals: ["requireAdmin"] },
    requiredDetection("An admin route is registered without admin authorization.", ["adminController"], ["requireAdmin"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 407, filePath: "src/routes/billing.ts", reviewComment: "Gate the new billing endpoint behind its feature flag.", rejectedCode: "router.post('/billing', billingController)", acceptedCode: "router.post('/billing', requireFeature('billing'), billingController)" },
    { intent: "architecture", title: "Feature-flag billing routes", rule: "New billing routes must apply the billing feature gate.", rationale: "The accepted route adds the billing feature gate.", prohibitedSignals: [], preferredSignals: ["requireFeature"] },
    requiredDetection("A billing route is registered without its feature gate.", ["billingController"], ["requireFeature"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 408, filePath: "src/routes/profile.ts", reviewComment: "State-changing browser routes need CSRF verification.", rejectedCode: "router.post('/profile', updateProfile)", acceptedCode: "router.post('/profile', verifyCsrf, updateProfile)" },
    { intent: "security", title: "Verify CSRF on profile updates", rule: "State-changing browser routes must verify CSRF tokens.", rationale: "The accepted route adds verifyCsrf.", prohibitedSignals: [], preferredSignals: ["verifyCsrf"] },
    requiredDetection("A profile update route lacks CSRF verification.", ["updateProfile"], ["verifyCsrf"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 409, filePath: "src/services/transfer.ts", reviewComment: "Debit and credit must be in one transaction.", rejectedCode: "await debit(account); await credit(target)", acceptedCode: "await database.transaction(async tx => { await debit(account, tx); await credit(target, tx) })" },
    { intent: "architecture", title: "Make transfers transactional", rule: "Coupled debit and credit writes must share a transaction.", rationale: "The accepted implementation wraps both writes in one transaction.", prohibitedSignals: [], preferredSignals: ["database.transaction"] },
    requiredDetection("Coupled transfer writes occur without a shared transaction.", ["debit", "credit"], ["database.transaction"], "file"),
  ),
  row(
    { repository: "acme/platform", pullRequest: 410, filePath: "src/jobs/reconcile.ts", reviewComment: "Await the reconciliation write before completing the job.", rejectedCode: "repository.save(result); return done()", acceptedCode: "await repository.save(result); return done()" },
    { intent: "actionable-change", title: "Await reconciliation writes", rule: "Job persistence must finish before completion is returned.", rationale: "The accepted job awaits repository.save.", prohibitedSignals: [], preferredSignals: ["await repository.save"] },
    requiredDetection("A reconciliation write is not awaited.", ["repository.save"], ["await repository.save"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 411, filePath: "src/hooks/useExpiry.test.ts", reviewComment: "Fix the clock before testing expiry behavior.", rejectedCode: "expect(isExpired(new Date())).toBe(true)", acceptedCode: "vi.setSystemTime(expiredAt); expect(isExpired(new Date())).toBe(true)" },
    { intent: "testing", title: "Fix time in expiry tests", rule: "Time-dependent tests must control the system clock.", rationale: "The accepted test fixes system time before the assertion.", prohibitedSignals: [], preferredSignals: ["vi.setSystemTime"] },
    requiredDetection("An expiry test depends on wall-clock time.", ["isExpired"], ["vi.setSystemTime"], "file"),
  ),
  row(
    { repository: "acme/web", pullRequest: 412, filePath: "src/components/Viewer.test.tsx", reviewComment: "Install the GraphQL mock before rendering.", rejectedCode: "render(<Viewer />)", acceptedCode: "server.use(graphql.query('Viewer', viewerHandler)); render(<Viewer />)" },
    { intent: "testing", title: "Mock Viewer GraphQL requests", rule: "Component tests must install GraphQL handlers for network operations.", rationale: "The accepted test installs the Viewer query handler.", prohibitedSignals: [], preferredSignals: ["server.use"] },
    requiredDetection("A Viewer component test renders without its GraphQL mock.", ["render(<Viewer"], ["server.use"], "file"),
  ),
  row(
    { repository: "acme/api", pullRequest: 413, filePath: "src/routes/search.ts", reviewComment: "Validate the query before invoking search.", rejectedCode: "return searchService.find(req.query)", acceptedCode: "const query = searchSchema.parse(req.query); return searchService.find(query)" },
    { intent: "security", title: "Validate search queries", rule: "Search routes must validate request queries before using them.", rationale: "The accepted route parses the query with searchSchema.", prohibitedSignals: [], preferredSignals: ["searchSchema.parse"] },
    requiredDetection("Search is invoked with an unvalidated request query.", ["searchService.find"], ["searchSchema.parse"], "file"),
  ),
  row(
    { repository: "acme/api", pullRequest: 414, filePath: "src/routes/login.ts", reviewComment: "Apply the login rate limiter here.", rejectedCode: "router.post('/login', loginController)", acceptedCode: "router.post('/login', loginRateLimit, loginController)" },
    { intent: "security", title: "Rate-limit login routes", rule: "Login routes must apply the repository rate limiter.", rationale: "The accepted route adds loginRateLimit.", prohibitedSignals: [], preferredSignals: ["loginRateLimit"] },
    requiredDetection("A login route is registered without rate limiting.", ["loginController"], ["loginRateLimit"]),
  ),
  row(
    { repository: "acme/api", pullRequest: 415, filePath: "src/repositories/orders.ts", reviewComment: "Tenant-scoped reads must include tenantId.", rejectedCode: "return prisma.order.findMany({ where: { status } })", acceptedCode: "return prisma.order.findMany({ where: { tenantId, status } })" },
    { intent: "security", title: "Scope order reads by tenant", rule: "Order queries must include the current tenant identifier.", rationale: "The accepted query adds tenantId to its filter.", prohibitedSignals: [], preferredSignals: ["tenantId"] },
    requiredDetection("An order query is issued without a tenant filter.", ["prisma.order.findMany"], ["tenantId"], "file"),
  ),
  row(
    { repository: "acme/api", pullRequest: 416, filePath: "src/routes/payments.ts", reviewComment: "Payment creation needs the idempotency middleware.", rejectedCode: "router.post('/payments', createPayment)", acceptedCode: "router.post('/payments', requireIdempotencyKey, createPayment)" },
    { intent: "architecture", title: "Require payment idempotency", rule: "Payment creation routes must require an idempotency key.", rationale: "The accepted route adds requireIdempotencyKey.", prohibitedSignals: [], preferredSignals: ["requireIdempotencyKey"] },
    requiredDetection("A payment creation route lacks idempotency protection.", ["createPayment"], ["requireIdempotencyKey"]),
  ),
  row(
    { repository: "acme/web", pullRequest: 417, filePath: "src/components/IconButton.tsx", reviewComment: "Icon-only buttons need an accessible label.", rejectedCode: "<button onClick={save}><SaveIcon /></button>", acceptedCode: "<button aria-label='Save' onClick={save}><SaveIcon /></button>" },
    { intent: "actionable-change", title: "Label icon-only buttons", rule: "Icon-only buttons must provide an accessible label.", rationale: "The accepted button adds aria-label.", prohibitedSignals: [], preferredSignals: ["aria-label"] },
    requiredDetection("An icon-only save button has no accessible label.", ["SaveIcon"], ["aria-label"]),
  ),
];

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const dbDomains = [
  "account", "address", "alert", "asset", "attachment", "booking", "cart", "category",
  "comment", "coupon", "customer", "delivery", "device", "event", "export", "feed", "group",
  "invoice", "item", "ledger", "membership", "message", "notification", "organization", "payment",
  "plan", "profile", "receipt", "report", "role", "session", "shipment", "subscription", "team", "user",
];
const secrets = [
  "accessToken", "apiKey", "authCode", "clientSecret", "cookieValue", "creditCard", "cvv",
  "databasePassword", "encryptionKey", "jwt", "oauthToken", "oneTimeCode", "password", "passwordHash",
  "privateKey", "recoveryCode", "refreshToken", "secretKey", "sessionSecret", "sessionToken",
  "signingKey", "socialSecurityNumber", "temporaryPassword", "totpSecret", "webhookSecret",
];
const clientResources = [
  "accounts", "alerts", "assets", "bookings", "categories", "comments", "coupons", "customers",
  "deliveries", "devices", "events", "exports", "feeds", "groups", "invoices", "memberships",
  "messages", "notifications", "payments", "shipments",
];
const sqlEntities = [
  "accounts", "audit_logs", "bookings", "comments", "customers", "devices", "events", "invoices",
  "memberships", "messages", "notifications", "payments", "receipts", "sessions", "shipments",
];
const runtimes = ["node", "python", "golang", "ruby", "php", "postgres", "redis", "nginx", "alpine", "ubuntu"];

const forbiddenCurriculum = [
  ...dbDomains.map((domain, index) => row(
    { repository: `curriculum/service-${index % 7}`, pullRequest: 1000 + index, filePath: `src/controllers/${domain}.ts`, reviewComment: `${capitalize(domain)} controllers must delegate persistence to the service layer.`, rejectedCode: `return prisma.${domain}.findMany({ where: filter })`, acceptedCode: `return ${domain}Service.list(filter)` },
    { intent: "architecture", title: `Keep Prisma out of ${domain} controllers`, rule: `${capitalize(domain)} controllers must delegate persistence to services.`, rationale: `The accepted implementation replaces controller-level Prisma access with the ${domain} service.`, prohibitedSignals: [`prisma.${domain}.findMany`], preferredSignals: [`${domain}Service.list`] },
    forbiddenDetection(`A ${domain} controller accesses Prisma directly.`, [`prisma.${domain}.findMany`]),
  )),
  ...secrets.map((secret, index) => row(
    { repository: `curriculum/platform-${index % 5}`, pullRequest: 1100 + index, filePath: `src/logging/event-${index}.ts`, reviewComment: `Do not include ${secret} in structured logs.`, rejectedCode: `logger.warn('operation failed', { requestId, ${secret} })`, acceptedCode: "logger.warn('operation failed', { requestId })" },
    { intent: "security", title: `Do not log ${secret}`, rule: `${capitalize(secret)} values must not be written to structured logs.`, rationale: `The accepted log preserves its request identifier while removing ${secret}.`, prohibitedSignals: [secret], preferredSignals: [] },
    forbiddenDetection(`A structured log contains ${secret}.`, [secret], ["logger.warn"]),
  )),
  ...clientResources.map((resource, index) => row(
    { repository: `curriculum/web-${index % 4}`, pullRequest: 1200 + index, filePath: `src/pages/${capitalize(resource)}.tsx`, reviewComment: `Use the ${resource} query hook instead of fetching server state in an effect.`, rejectedCode: `useEffect(() => { fetch('/api/${resource}').then(load${capitalize(resource)}) }, [])`, acceptedCode: `const query = use${capitalize(resource)}Query()` },
    { intent: "architecture", title: `Use the ${resource} query hook`, rule: `${capitalize(resource)} pages must use the repository query hook for server state.`, rationale: `The accepted component replaces effect-based fetching with use${capitalize(resource)}Query.`, prohibitedSignals: ["useEffect", "fetch"], preferredSignals: [`use${capitalize(resource)}Query`] },
    forbiddenDetection(`A ${resource} page fetches server state inside useEffect.`, ["useEffect", "fetch"]),
  )),
  ...sqlEntities.map((entity, index) => row(
    { repository: `curriculum/python-${index % 3}`, pullRequest: 1300 + index, filePath: `repositories/${entity}.py`, reviewComment: "Bind query parameters instead of concatenating user input.", rejectedCode: `cursor.execute("SELECT * FROM ${entity} WHERE id=" + record_id)`, acceptedCode: `cursor.execute("SELECT * FROM ${entity} WHERE id=%s", (record_id,))` },
    { intent: "security", title: `Parameterize ${entity} queries`, rule: `${capitalize(entity)} queries must bind user-provided parameters.`, rationale: "The accepted query passes the identifier as a bound parameter.", prohibitedSignals: ["+ record_id"], preferredSignals: ["%s"] },
    forbiddenDetection("A SQL query concatenates a record identifier.", ["+ record_id"], ["cursor.execute"]),
  )),
  ...runtimes.map((runtime, index) => row(
    { repository: `curriculum/runtime-${index % 3}`, pullRequest: 1400 + index, filePath: "Dockerfile", reviewComment: `Pin the ${runtime} image instead of using latest.`, rejectedCode: `FROM ${runtime}:latest`, acceptedCode: `FROM ${runtime}:3.2` },
    { intent: "architecture", title: `Pin the ${runtime} image`, rule: `${capitalize(runtime)} container images must use an explicit version.`, rationale: "The accepted Dockerfile replaces the floating latest tag with an explicit version.", prohibitedSignals: [`${runtime}:latest`], preferredSignals: [`${runtime}:3.2`] },
    forbiddenDetection(`A ${runtime} image uses the floating latest tag.`, [`${runtime}:latest`]),
  )),
].slice(0, 105);

const routeResources = [
  "accounts", "alerts", "assets", "bookings", "carts", "categories", "comments", "coupons",
  "customers", "deliveries", "devices", "events", "exports", "feeds", "groups", "invoices",
  "items", "memberships", "messages", "notifications", "payments", "profiles", "receipts", "shipments", "teams",
];
const featureResources = [
  "analytics", "audit", "billing", "calendar", "checkout", "collaboration", "coupons", "delivery",
  "exports", "feeds", "invoices", "messaging", "notifications", "payments", "receipts", "recommendations",
  "scheduling", "shipments", "subscriptions", "teams",
];
const transactionDomains = [
  ["booking", "inventory"], ["charge", "receipt"], ["coupon", "redemption"], ["credit", "balance"],
  ["delivery", "status"], ["event", "audit"], ["invoice", "ledger"], ["membership", "seat"],
  ["message", "outbox"], ["order", "inventory"], ["payment", "ledger"], ["payout", "balance"],
  ["profile", "audit"], ["receipt", "email"], ["reservation", "capacity"], ["shipment", "inventory"],
  ["subscription", "invoice"], ["team", "membership"], ["transfer", "ledger"], ["user", "organization"],
];
const asyncOperations = [
  "auditStore.append", "backupStore.upload", "cache.persist", "catalog.publish", "deliveryQueue.enqueue",
  "emailQueue.send", "eventBus.publish", "exportStore.write", "feedStore.refresh", "fileStore.upload",
  "indexer.commit", "invoiceStore.save", "ledgerStore.append", "messageQueue.enqueue", "metrics.flush",
  "notificationQueue.send", "outbox.flush", "paymentStore.capture", "receiptStore.save", "shipmentStore.update",
];
const testComponents = ["AccountPanel", "AlertList", "BookingForm", "Cart", "Checkout", "CustomerCard", "Invoice", "MessageList", "PaymentForm", "ShipmentTracker"];
const csrfHandlers = ["changeEmail", "createAddress", "deleteAccount", "disableDevice", "inviteMember", "removeMember", "resetPassword", "savePreferences", "updateBilling", "updateProfile"];

const requiredCurriculum = [
  ...routeResources.map((resource, index) => {
    const handler = `get${capitalize(resource)}`;
    return row(
      { repository: `curriculum/api-${index % 6}`, pullRequest: 2000 + index, filePath: `src/routes/${resource}.ts`, reviewComment: `${capitalize(resource)} endpoints require authentication.`, rejectedCode: `router.get('/${resource}', ${handler})`, acceptedCode: `router.get('/${resource}', requireAuth, ${handler})` },
      { intent: "security", title: `Authenticate ${resource} endpoints`, rule: `${capitalize(resource)} endpoints must apply authentication middleware.`, rationale: "The accepted route adds requireAuth before the handler.", prohibitedSignals: [], preferredSignals: ["requireAuth"] },
      requiredDetection(`A ${resource} endpoint lacks authentication.`, [handler], ["requireAuth"]),
    );
  }),
  ...featureResources.map((resource, index) => {
    const handler = `open${capitalize(resource)}`;
    return row(
      { repository: `curriculum/api-${index % 6}`, pullRequest: 2100 + index, filePath: `src/routes/${resource}.ts`, reviewComment: `Gate the new ${resource} route behind its feature flag.`, rejectedCode: `router.post('/${resource}', ${handler})`, acceptedCode: `router.post('/${resource}', requireFeature('${resource}'), ${handler})` },
      { intent: "architecture", title: `Feature-flag ${resource} routes`, rule: `New ${resource} routes must apply their feature gate.`, rationale: "The accepted route adds requireFeature before the handler.", prohibitedSignals: [], preferredSignals: ["requireFeature"] },
      requiredDetection(`A ${resource} route lacks its feature gate.`, [handler], ["requireFeature"]),
    );
  }),
  ...transactionDomains.map(([left, right], index) => row(
    { repository: `curriculum/service-${index % 5}`, pullRequest: 2200 + index, filePath: `src/services/${left}.ts`, reviewComment: `The ${left} and ${right} writes must commit together.`, rejectedCode: `await ${left}Store.save(value); await ${right}Store.save(value)`, acceptedCode: `await database.transaction(async tx => { await ${left}Store.save(value, tx); await ${right}Store.save(value, tx) })` },
    { intent: "architecture", title: `Make ${left} writes transactional`, rule: `${capitalize(left)} and ${right} writes must execute in one transaction.`, rationale: "The accepted implementation wraps the coupled writes in database.transaction.", prohibitedSignals: [], preferredSignals: ["database.transaction"] },
    requiredDetection(`Coupled ${left} and ${right} writes occur without a transaction.`, [`${left}Store.save`, `${right}Store.save`], ["database.transaction"], "file"),
  )),
  ...asyncOperations.map((operation, index) => row(
    { repository: `curriculum/jobs-${index % 4}`, pullRequest: 2300 + index, filePath: `src/jobs/task-${index}.ts`, reviewComment: `Await ${operation} before reporting completion.`, rejectedCode: `${operation}(result); return completed()`, acceptedCode: `await ${operation}(result); return completed()` },
    { intent: "actionable-change", title: `Await ${operation}`, rule: `${operation} must finish before the job reports completion.`, rationale: "The accepted job awaits the asynchronous operation before returning.", prohibitedSignals: [], preferredSignals: [`await ${operation}`] },
    requiredDetection(`A job starts ${operation} without awaiting it.`, [operation], [`await ${operation}`]),
  )),
  ...testComponents.map((component, index) => row(
    { repository: `curriculum/web-${index % 3}`, pullRequest: 2400 + index, filePath: `src/components/${component}.test.tsx`, reviewComment: "Install the GraphQL mock before rendering this component.", rejectedCode: `render(<${component} />)`, acceptedCode: `server.use(graphql.query('${component}', handler)); render(<${component} />)` },
    { intent: "testing", title: `Mock ${component} GraphQL requests`, rule: `${component} tests must install their GraphQL handler before rendering.`, rationale: "The accepted test installs the network handler before rendering.", prohibitedSignals: [], preferredSignals: ["server.use"] },
    requiredDetection(`A ${component} test renders without its GraphQL mock.`, [`render(<${component}`], ["server.use"], "file"),
  )),
  ...csrfHandlers.map((handler, index) => row(
    { repository: `curriculum/web-${index % 3}`, pullRequest: 2500 + index, filePath: `src/routes/action-${index}.ts`, reviewComment: "State-changing browser routes require CSRF verification.", rejectedCode: `router.post('/action-${index}', ${handler})`, acceptedCode: `router.post('/action-${index}', verifyCsrf, ${handler})` },
    { intent: "security", title: `Protect ${handler} from CSRF`, rule: `Routes invoking ${handler} must verify CSRF tokens.`, rationale: "The accepted route adds verifyCsrf before the state-changing handler.", prohibitedSignals: [], preferredSignals: ["verifyCsrf"] },
    requiredDetection(`A state-changing ${handler} route lacks CSRF verification.`, [handler], ["verifyCsrf"]),
  )),
].slice(0, 105);

const questionTopics = [
  "account deletion", "alert delivery", "audit retention", "backup recovery", "booking expiry",
  "cache eviction", "calendar synchronization", "cart abandonment", "catalog refresh", "comment moderation",
  "coupon expiration", "customer merging", "data residency", "delivery retries", "device revocation",
  "email suppression", "event ordering", "export cleanup", "feed pagination", "file deduplication",
  "group ownership", "import rollback", "invoice numbering", "job cancellation", "ledger reconciliation",
  "membership expiry", "message ordering", "notification batching", "organization deletion", "payment reversal",
  "permission inheritance", "profile visibility", "rate-limit reset", "receipt delivery", "record archival",
  "retry exhaustion", "role propagation", "search ranking", "session expiration", "shipment cancellation",
  "subscription renewal", "team deletion", "tenant migration", "token rotation", "transaction recovery",
  "upload cleanup", "user anonymization", "webhook replay", "worker shutdown", "workflow cancellation",
];
const booleanNames = ["active", "available", "complete", "connected", "disabled", "editable", "empty", "enabled", "expired", "focused", "hidden", "invalid", "locked", "open", "pending", "selected", "successful", "synced", "valid", "visible"];
const helperDomains = ["currency", "date", "duration", "email", "filename", "locale", "money", "percentage", "phone", "postalCode", "quantity", "relativeTime", "slug", "timezone", "url"];
const responsibilityDomains = ["audit", "billing", "caching", "delivery", "email", "exports", "imports", "invoicing", "logging", "messaging", "notifications", "payments", "permissions", "reporting", "search", "shipping", "subscriptions", "telemetry", "validation", "webhooks"];

const semanticCurriculum = [
  ...questionTopics.map((topic, index) => row(
    { repository: `curriculum/discussion-${index % 5}`, pullRequest: 3000 + index, filePath: `src/domain/topic-${index}.ts`, reviewComment: `How does ${topic} behave when the operation is interrupted?`, rejectedCode: `return handleOperation(state)`, acceptedCode: "" },
    { intent: "question-nonactionable", title: `Define interrupted ${topic} behavior`, rule: `The repository has not established how ${topic} behaves when interrupted; an explicit product decision is required before enforcement.`, rationale: "The comment is a question and no accepted change establishes an executable convention.", prohibitedSignals: [], preferredSignals: [] },
    semanticDetection(`The review asks for clarification about ${topic}.`),
  )),
  ...booleanNames.map((name, index) => row(
    { repository: `curriculum/style-${index % 4}`, pullRequest: 3100 + index, filePath: `src/state/value-${index}.ts`, reviewComment: `Rename this boolean so it reads as a predicate.`, rejectedCode: `const ${name} = status === '${name}'`, acceptedCode: `const is${capitalize(name)} = status === '${name}'` },
    { intent: "style", title: `Use a predicate name for ${name}`, rule: `The ${name} boolean should use a predicate-style name.`, rationale: `The accepted code renames ${name} to is${capitalize(name)}.`, prohibitedSignals: [name], preferredSignals: [`is${capitalize(name)}`] },
    semanticDetection(`A ${name} boolean does not use a predicate-style name.`),
  )),
  ...helperDomains.map((domain, index) => row(
    { repository: `curriculum/style-${index % 4}`, pullRequest: 3200 + index, filePath: `src/format/value-${index}.ts`, reviewComment: `Use the shared ${domain} formatter here.`, rejectedCode: `const value = locallyFormat${capitalize(domain)}(input)`, acceptedCode: `const value = format${capitalize(domain)}(input)` },
    { intent: "style", title: `Use the shared ${domain} formatter`, rule: `${capitalize(domain)} values should use the repository's shared formatter.`, rationale: "The accepted code uses the shared helper, but the repository-wide condition is best represented semantically.", prohibitedSignals: [`locallyFormat${capitalize(domain)}`], preferredSignals: [`format${capitalize(domain)}`] },
    semanticDetection(`A ${domain} value bypasses the shared formatter.`),
  )),
  ...responsibilityDomains.map((domain, index) => row(
    { repository: `curriculum/design-${index % 4}`, pullRequest: 3300 + index, filePath: `src/factories/value-${index}.ts`, reviewComment: `Is this factory really the right owner for ${domain}?`, rejectedCode: `await ${domain}Coordinator.run(value)`, acceptedCode: "" },
    { intent: "question-nonactionable", title: `Define ${domain} responsibility`, rule: `Ownership of ${domain} between the factory and coordinator is not established and requires an explicit architectural decision.`, rationale: "The comment raises an architectural question without an accepted replacement.", prohibitedSignals: [], preferredSignals: [] },
    semanticDetection(`The review questions ownership of ${domain}.`),
  )),
].slice(0, 105);

const curriculumRows = [...forbiddenCurriculum, ...requiredCurriculum, ...semanticCurriculum];

const realEpisodes = JSON.parse(await readFile(resolve(root, "packages/api-server/data/episodes.json"), "utf8"));
const eligibleRealEpisodes = realEpisodes
  .filter((episode) => episode.acceptedFixQuality === "medium" && episode.reviewComment && episode.rejectedCode)
  .sort((left, right) => left.id.localeCompare(right.id));

function contextualRuleFromEpisode(episode) {
  const comment = episode.reviewComment.toLowerCase();
  const known = [
    [/no-store.*health endpoints|cache policy live on api routes/, "Cache-control policy must be explicitly scoped so global defaults do not unintentionally affect health endpoints."],
    [/strictness setting.*boundary parsing|unchecked request data/, "Request boundaries must parse untrusted data instead of bypassing strict typing with unchecked assertions."],
    [/documented meaning.*severity|interpretations of sev1/, "Incident severity levels must have documented meanings shared by the API and its clients."],
    [/responder notes count as incident updates|sorting purposes/, "The incident domain must define and test whether responder notes update incident recency and sorting."],
    [/minimum supported node version|fastify.*node version/, "The project must document and enforce the minimum Node.js version required by its Fastify release."],
    [/assignment.*first milestone|incident commander.*initial workflow/, "The initial incident workflow must explicitly define whether responder assignment is supported or only an incident commander."],
    [/id generation.*injected|deterministic ids/, "Incident services should accept an injectable ID generator so tests can use deterministic identifiers."],
    [/location.*new incident resource|returning 201/, "HTTP 201 responses for newly created incidents should include a Location header identifying the new resource."],
    [/incidentnotfounderror|domain-specific.*notfound/, "Missing incidents must be represented by a typed domain error rather than message text consumed by the HTTP layer."],
    [/transition-specific endpoint|patch preferred/, "The incident API must explicitly choose and consistently document how lifecycle transitions are represented for clients."],
    [/example health-check request|local server started/, "Contributor setup documentation should include a health-check request that verifies the local server is ready."],
    [/configuration test.*non-numeric|non-numeric values/, "Configuration parsing tests must cover non-numeric values and preserve understandable startup failures."],
    [/resolved incidents still accept notes|active-state rule/, "The incident-note API must explicitly define and enforce whether resolved incidents may accept post-incident notes."],
    [/pinning.*digest/, "Production container images should use immutable digest pins that dependency automation can update."],
    [/lockfile.*npm ci|npm ci.*lockfile/, "Projects that install dependencies with `npm ci` must commit and maintain a lockfile."],
    [/development dependencies.*production/, "Production container images must exclude development-only dependencies."],
    [/fresh instance.*beforeeach|closed after the first test/, "Tests that close application instances must create a fresh instance for each test."],
    [/content type.*request-id/, "Health endpoint tests must assert response content type and request-ID headers."],
    [/returned incident fields|input preservation/, "Creation tests should assert that returned domain fields preserve requested inputs."],
    [/createdat.*updatedat/, "Creation tests must verify that `createdAt` and `updatedAt` begin equal."],
    [/unknown id.*domain error/, "Domain-service tests must assert the typed error returned for unknown identifiers."],
    [/incident factory|named builder/, "Complex test fixtures should use named builders with sensible defaults."],
    [/clear test.*empty store/, "Store-clearing tests must seed data before invoking `clear`."],
    [/configuration failures.*fatal/, "Startup configuration failures must be logged as concise fatal events before exit."],
    [/second signal.*close/, "Graceful shutdown handlers must prevent duplicate work while shutdown is already in progress."],
    [/startup errors.*caught|address-in-use/, "Application startup must catch and log operational failures before exiting."],
    [/onsend.*error response/, "Request-context tests must verify headers on every error path affected by response hooks."],
    [/trusted incoming request id/, "Request IDs must come from a bounded trusted source or be generated by the service."],
    [/no-store globally/, "Cache-control policy should be scoped to routes whose responses must not be cached."],
    [/zod paths.*field names/, "Public validation errors must expose stable field names rather than library-specific path structures."],
    [/matching error text is brittle|typed not-found error/, "Domain failures must use typed errors instead of message-text matching."],
  ];
  const match = known.find(([pattern]) => pattern.test(comment));
  if (match) return match[1];
  throw new Error(`Real episode ${episode.id} needs a human-curated contextual rule before training`);
}

function semanticOnlyRealRow(episode) {
  const input = {
    repository: episode.repository,
    pullRequest: episode.pullRequest,
    filePath: episode.filePath,
    reviewComment: episode.reviewComment,
    rejectedCode: episode.rejectedCode,
    acceptedCode: episode.acceptedCode,
    ...(episode.codeContext ? { codeContext: episode.codeContext } : {}),
  };
  const semantic = episode.semanticAnalysis ?? {};
  const rule = contextualRuleFromEpisode(episode);
  const title = rule.split(/[.!?]/)[0].slice(0, 100);
  const unresolvedDecision = /no-store.*health endpoints|responder notes count as incident updates|assignment.*first milestone|transition-specific endpoint|resolved incidents still accept notes|trusted incoming request id/i
    .test(episode.reviewComment);
  return {
    input: JSON.stringify({
      task: "analyze_review_episode",
      version: "2",
      instruction: systemInstruction,
      episode: input,
    }),
    output: JSON.stringify({
      intent: unresolvedDecision ? "question-nonactionable" : semantic.intent || episode.intent || "actionable-change",
      title,
      rule,
      rationale: "The linked merged code does not isolate a safe exact signal, so this review remains semantic-only.",
      detection: semanticDetection(rule),
    }),
  };
}

const realTraining = eligibleRealEpisodes.slice(0, 10).map(semanticOnlyRealRow);
function evaluationConceptsFromEpisode(episode) {
  const comment = episode.reviewComment.toLowerCase();
  const concepts = [
    [/location.*returning 201/, ["location", "201|created", "resource|incident"]],
    [/incidentnotfounderror|domain-specific.*wording/, ["typed|domain", "error", "message|http"]],
    [/transition-specific endpoint|patch preferred/, ["transition|lifecycle", "api|endpoint|patch", "define|choose|document"]],
    [/example health-check request/, ["document|setup|contributor", "health", "request|example"]],
    [/configuration test.*non-numeric/, ["configuration", "non-numeric|numeric", "test|failure"]],
    [/input preservation|requested title and severity/, ["test", "title", "severity"]],
    [/content type.*request-id/, ["health", "content", "request-id|request id"]],
    [/resolved incidents still accept notes/, ["resolved", "notes", "define|enforce|allow|accept"]],
    [/lockfile.*npm ci|npm ci.*lockfile/, ["lockfile", "npm ci"]],
    [/trusted incoming request id/, ["request id|request correlation", "trusted|generated|service"]],
  ].find(([pattern]) => pattern.test(comment));
  if (!concepts) throw new Error(`Real evaluation episode ${episode.id} needs curated evaluation concepts`);
  return concepts[1];
}

const realEvaluation = eligibleRealEpisodes.slice(10, 20).map((episode) => ({
  ...semanticOnlyRealRow(episode),
  evaluationConcepts: evaluationConceptsFromEpisode(episode),
}));
const baseTraining = [...train, ...additionalExecutable, ...realTraining, ...curriculumRows];

function conversationalVariant(item, index, variant) {
  const input = JSON.parse(item.input);
  const output = JSON.parse(item.output);
  const episode = input.episode;
  const title = output.title.replace(/[.!?]+$/, "").toLowerCase();
  const reviewComment = variant === 0
    ? `Could we align this with the repository's ${title} convention? The current version feels inconsistent with nearby code.`
    : `This looks like the same issue we handled elsewhere. Please apply the established ${title} approach here.`;
  return {
    input: JSON.stringify({
      ...input,
      episode: {
        ...episode,
        repository: `contextual/${output.detection.mode}-${index % 9}`,
        pullRequest: 10_000 + index * 2 + variant,
        reviewComment,
      },
    }),
    output: item.output,
  };
}

const contextualTraining = ["forbidden-signal", "missing-required-signal", "semantic"].flatMap((mode) => {
  const rows = baseTraining.filter((item) => JSON.parse(item.output).detection.mode === mode);
  return [
    ...rows.map((item, index) => conversationalVariant(item, index, 0)),
    ...rows.slice(0, 60).map((item, index) => conversationalVariant(item, index, 1)),
  ];
});

const completeTraining = [...baseTraining, ...contextualTraining];
const completeEvaluation = [...evaluation, ...additionalEvaluation, ...realEvaluation];

const modeCounts = completeTraining.reduce((counts, item) => {
  const mode = JSON.parse(item.output).detection.mode;
  counts[mode] = (counts[mode] ?? 0) + 1;
  return counts;
}, {});
if (completeTraining.length !== 900 || Object.values(modeCounts).some((count) => count !== 300)) {
  throw new Error(`Training set must contain 900 balanced rows; got ${JSON.stringify(modeCounts)}`);
}
if (new Set(completeTraining.map((item) => item.input)).size !== completeTraining.length) {
  throw new Error("Training set contains duplicate inputs");
}

function assertContextualRuleTargets(rows, label) {
  rows.forEach((item, index) => {
    const { rule } = JSON.parse(item.output);
    if (!rule || /should would|the reviewer|this comment|this pr|code in this repository area/i.test(rule)
      || /[?]\s*$/.test(rule)) {
      throw new Error(`${label} row ${index} has a review-dependent or non-declarative rule: ${JSON.stringify(rule)}`);
    }
  });
}

assertContextualRuleTargets(completeTraining, "Training");
assertContextualRuleTargets(completeEvaluation, "Evaluation");

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "train.jsonl"), `${completeTraining.map(JSON.stringify).join("\n")}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "eval.jsonl"), `${completeEvaluation.map(JSON.stringify).join("\n")}\n`, "utf8"),
]);

process.stderr.write(`Wrote ${completeTraining.length} balanced training rows ${JSON.stringify(modeCounts)} and ${completeEvaluation.length} evaluation rows (${realEvaluation.length} real semantic-only) to ${outputDirectory}\n`);
