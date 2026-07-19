import type {
  CommentIntent as SharedCommentIntent,
  Convention as SharedConvention,
  LinkageQuality as SharedLinkageQuality,
  ReviewEpisode as SharedReviewEpisode,
} from "@ht6/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommentIntent,
  ExtractionRunStatus,
  LinkageQuality,
  PrismaClient,
  type Prisma,
} from "../generated/prisma/client.js";
import type {
  ExtractionPublisher,
  ExtractionPublishResult,
  ExtractionSnapshot,
} from "./types.js";
import { inputDigest } from "./inputDigest.js";

function databaseIntent(intent: SharedCommentIntent): CommentIntent {
  const values: Record<SharedCommentIntent, CommentIntent> = {
    "actionable-change": CommentIntent.ACTIONABLE,
    architecture: CommentIntent.ARCHITECTURE,
    testing: CommentIntent.TESTING,
    security: CommentIntent.SECURITY,
    style: CommentIntent.STYLE,
    "question-nonactionable": CommentIntent.QUESTION,
  };
  return values[intent];
}

function databaseLinkageQuality(quality: SharedLinkageQuality): LinkageQuality {
  const values: Record<SharedLinkageQuality, LinkageQuality> = {
    high: LinkageQuality.HIGH,
    medium: LinkageQuality.MEDIUM,
    unknown: LinkageQuality.UNKNOWN,
  };
  return values[quality];
}

function groupByRepository<T extends { repository: string }>(records: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const values = grouped.get(record.repository) ?? [];
    values.push(record);
    grouped.set(record.repository, values);
  }
  return grouped;
}

async function createEpisode(
  transaction: Prisma.TransactionClient,
  runId: string,
  episode: SharedReviewEpisode
): Promise<string> {
  const created = await transaction.reviewEpisode.create({
    data: {
      runId,
      episodeKey: episode.id,
      pullRequest: episode.pullRequest,
      reviewer: episode.reviewer,
      filePath: episode.filePath,
      reviewComment: episode.reviewComment,
      rejectedCode: episode.rejectedCode,
      acceptedCode: episode.acceptedCode,
      acceptedFixQuality: databaseLinkageQuality(episode.acceptedFixQuality),
      intent: databaseIntent(episode.intent),
      semanticTitle: episode.semanticAnalysis.title,
      semanticRule: episode.semanticAnalysis.rule,
      semanticRationale: episode.semanticAnalysis.rationale,
      prohibitedSignals: episode.semanticAnalysis.prohibitedSignals,
      preferredSignals: episode.semanticAnalysis.preferredSignals,
      semanticSnapshot: episode.semanticAnalysis as unknown as Prisma.InputJsonValue,
      sourceCreatedAt: new Date(episode.createdAt),
    },
    select: { id: true },
  });
  return created.id;
}

async function createConvention(
  transaction: Prisma.TransactionClient,
  runId: string,
  convention: SharedConvention,
  episodeIds: Map<string, string>
): Promise<void> {
  const created = await transaction.convention.create({
    data: {
      runId,
      conventionKey: convention.id,
      title: convention.title,
      rule: convention.rule,
      rationale: convention.rationale,
      category: databaseIntent(convention.category as SharedCommentIntent),
      pathScopes: convention.pathScopes,
      languages: convention.languages,
      prohibitedSignals: convention.prohibitedSignals,
      preferredSignals: convention.preferredSignals,
      detection: convention.detection as Prisma.InputJsonValue | undefined,
      confidence: convention.confidence,
    },
    select: { id: true },
  });

  const evidence = convention.supportingEpisodes.map((episodeKey, position) => {
    const episodeId = episodeIds.get(episodeKey);
    if (!episodeId) {
      throw new Error(`Convention ${convention.id} references missing episode ${episodeKey}`);
    }
    return { conventionId: created.id, episodeId, position };
  });
  if (evidence.length > 0) await transaction.conventionEvidence.createMany({ data: evidence });
}

export class PrismaExtractionPublisher implements ExtractionPublisher {
  constructor(private readonly prisma: PrismaClient) {}

  async publish(snapshot: ExtractionSnapshot): Promise<ExtractionPublishResult> {
    const commentsByRepository = groupByRepository(snapshot.comments);
    const episodesByRepository = groupByRepository(snapshot.episodes);
    const conventionsByRepository = groupByRepository(snapshot.conventions);

    for (const [slug, comments] of commentsByRepository) {
      const repository = await this.prisma.repository.upsert({
        where: { slug },
        create: { slug },
        update: {},
        select: { id: true, activeExtractionRunId: true },
      });
      const episodes = episodesByRepository.get(slug) ?? [];
      const conventions = conventionsByRepository.get(slug) ?? [];
      const digest = inputDigest(comments);
      const fingerprint = {
        repositoryId: repository.id,
        inputDigest: digest,
        extractorVersion: snapshot.extractorVersion,
        analyzerProvider: snapshot.analyzerProvider,
        analyzerVersion: snapshot.analyzerVersion,
      } as const;
      // Prefer the currently published winner. Under overlapping refreshes a newer
      // superseded row can otherwise be selected and then collide while promoted.
      const published = await this.prisma.extractionRun.findFirst({
        where: {
          ...fingerprint,
          status: ExtractionRunStatus.PUBLISHED,
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      const reusable = published ?? await this.prisma.extractionRun.findFirst({
        where: {
          ...fingerprint,
          status: ExtractionRunStatus.SUPERSEDED,
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      if (reusable) {
        if (repository.activeExtractionRunId !== reusable.id) {
          await this.prisma.$transaction(async (transaction) => {
            if (repository.activeExtractionRunId) {
              await transaction.extractionRun.update({
                where: { id: repository.activeExtractionRunId },
                data: { status: ExtractionRunStatus.SUPERSEDED },
              });
            }
            await transaction.extractionRun.update({
              where: { id: reusable.id },
              data: { status: ExtractionRunStatus.PUBLISHED },
            });
            await transaction.repository.update({
              where: { id: repository.id },
              data: { activeExtractionRunId: reusable.id },
            });
          });
        }
        continue;
      }
      const run = await this.prisma.extractionRun.create({
        data: {
          ...fingerprint,
          inputCommentCount: comments.length,
        },
        select: { id: true },
      });

      try {
        await this.prisma.$transaction(async (transaction) => {
          const episodeIds = new Map<string, string>();
          for (const episode of episodes) {
            episodeIds.set(episode.id, await createEpisode(transaction, run.id, episode));
          }
          for (const convention of conventions) {
            await createConvention(transaction, run.id, convention, episodeIds);
          }

          if (repository.activeExtractionRunId) {
            await transaction.extractionRun.update({
              where: { id: repository.activeExtractionRunId },
              data: { status: ExtractionRunStatus.SUPERSEDED },
            });
          }
          await transaction.extractionRun.update({
            where: { id: run.id },
            data: {
              status: ExtractionRunStatus.PUBLISHED,
              episodeCount: episodes.length,
              conventionCount: conventions.length,
              completedAt: new Date(),
            },
          });
          await transaction.repository.update({
            where: { id: repository.id },
            data: { activeExtractionRunId: run.id },
          });
        });
      } catch (error) {
        // Two workers can both observe no reusable run and build the same snapshot.
        // The partial unique index chooses one winner at PUBLISHED transition. If an
        // equivalent winner now exists, discard this empty rolled-back BUILDING row
        // and treat publication as the idempotent success it is.
        const concurrentWinner = await this.prisma.extractionRun.findFirst({
          where: {
            ...fingerprint,
            status: ExtractionRunStatus.PUBLISHED,
          },
          select: { id: true },
        });
        if (concurrentWinner) {
          await this.prisma.extractionRun.delete({ where: { id: run.id } });
          continue;
        }
        await this.prisma.extractionRun.update({
          where: { id: run.id },
          data: {
            status: ExtractionRunStatus.FAILED,
            completedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    }

    return { repositoryCount: commentsByRepository.size };
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export function createPrismaExtractionPublisher(connectionString: string): PrismaExtractionPublisher {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaExtractionPublisher(new PrismaClient({ adapter }));
}
