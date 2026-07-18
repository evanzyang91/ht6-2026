import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "training/freesolo/datasets");

const systemInstruction = [
  "Normalize one pull-request review episode into the Engineering Memory SemanticAnalysis schema.",
  "Use only the supplied evidence and return raw JSON without Markdown. Return exactly: intent,",
  "title, rule, rationale, prohibitedSignals, preferredSignals, detection. intent must be one of",
  "actionable-change, architecture, testing, security, style, question-nonactionable. Signals must",
  "be exact code substrings, never English descriptions. detection contains mode, semanticDescription,",
  "triggerSignals, forbiddenSignals, requiredSignals, matchScope. Use forbidden-signal when code is",
  "disallowed in the trigger context, missing-required-signal when the trigger requires absent code,",
  "and semantic only when deterministic signals cannot represent the condition. Use codeContext to",
  "understand the enclosing symbol and imports, but do not invent repository facts. When acceptedCode",
  "adds a guard, middleware, wrapper, modifier, await, mock, or helper missing from rejectedCode, use",
  "missing-required-signal; keep prohibitedSignals and forbiddenSignals empty, set preferredSignals",
  "equal to requiredSignals, and never mark the trigger itself forbidden. Use forbidden-signal only",
  "when acceptedCode removes or replaces a disallowed construct. Prefer the smallest reusable exact",
  "substring over an entire code line. Treat feature flags as architecture/release-control conventions.",
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
      version: "1",
      instruction: systemInstruction,
      episode: { ...input, codeContext: input.codeContext ?? mockCodeContext(input) },
    }),
    output: JSON.stringify({ ...output, detection: resolvedDetection }),
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
    { intent: "question-nonactionable", title: "Question about factory responsibility", rule: "The reviewer is asking for clarification about why the factory sends notifications.", rationale: "The comment is a question and no accepted replacement demonstrates a required convention.", prohibitedSignals: [], preferredSignals: [] },
  ),
  row(
    { repository: "acme/web", pullRequest: 126, filePath: "src/cache/profile.ts", reviewComment: "How does this cache get invalidated?", rejectedCode: "profileCache.set(userId, profile)", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Question about cache invalidation", rule: "The reviewer is asking how cache invalidation works.", rationale: "The comment requests an explanation and supplies no accepted code change.", prohibitedSignals: [], preferredSignals: [] },
  ),
  row(
    { repository: "acme/platform", pullRequest: 61, filePath: "src/config/loader.ts", reviewComment: "Could you explain why this configuration is loaded twice?", rejectedCode: "loadConfig(); initialize(); loadConfig()", acceptedCode: "" },
    { intent: "question-nonactionable", title: "Question about duplicate configuration loading", rule: "The reviewer is asking for an explanation of duplicate configuration loading.", rationale: "The evidence does not establish a requested or accepted engineering convention.", prohibitedSignals: [], preferredSignals: [] },
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
    { intent: "question-nonactionable", title: "Question about exhausted retries", rule: "The reviewer is asking what happens after retry attempts are exhausted.", rationale: "The comment asks for clarification and provides no accepted implementation change.", prohibitedSignals: [], preferredSignals: [] },
  ),
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "train.jsonl"), `${train.map(JSON.stringify).join("\n")}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "eval.jsonl"), `${evaluation.map(JSON.stringify).join("\n")}\n`, "utf8"),
]);

process.stderr.write(`Wrote ${train.length} mock training rows and ${evaluation.length} evaluation rows to ${outputDirectory}\n`);
