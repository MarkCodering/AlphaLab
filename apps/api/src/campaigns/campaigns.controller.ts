import type { MessageEvent } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
  Sse,
  Version,
} from '@nestjs/common';
import type { Response } from 'express';
import type { DomainEvent } from '@alphalab/contracts';
import { concat, filter, from, fromEvent, map, type Observable } from 'rxjs';
import {
  actorFromHeaders,
  requireExpectedVersion,
  requireIdempotencyKey,
} from '../common/actor.js';
import { CampaignsService } from './campaigns.service.js';

@Controller()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('projects')
  @Version('1')
  listProjects(
    @Query('organizationId') organizationId: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listProjects(actorFromHeaders(actorId, actorRole), organizationId);
  }

  @Get('organizations/:organizationId/execution-controls')
  @Version('1')
  getExecutionControl(@Param('organizationId') organizationId: string) {
    return this.campaigns.getExecutionControl(organizationId);
  }

  @Put('organizations/:organizationId/execution-controls')
  @Version('1')
  updateExecutionControl(
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('if-match') expectedVersion?: string,
  ) {
    return this.campaigns.updateExecutionControl(
      organizationId,
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
      requireExpectedVersion(expectedVersion),
    );
  }

  @Get('projects/:id')
  @Version('1')
  getProject(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.getProject(id, actorFromHeaders(actorId, actorRole));
  }

  @Post('projects')
  @Version('1')
  createProject(
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.createProject(
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('projects/:id/members')
  @Version('1')
  listProjectMembers(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listProjectMembers(id, actorFromHeaders(actorId, actorRole));
  }

  @Post('projects/:id/members')
  @Version('1')
  grantProjectMember(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.campaigns.grantProjectMember(
      id,
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('targets')
  @Version('1')
  createTarget(
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.createTarget(
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('targets')
  @Version('1')
  listTargets(
    @Query('projectId') projectId: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listTargets(projectId, actorFromHeaders(actorId, actorRole));
  }

  @Post('datasets')
  @Version('1')
  createDataset(
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.createDataset(
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('datasets')
  @Version('1')
  listDatasets(
    @Query('projectId') projectId: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listDatasets(projectId, actorFromHeaders(actorId, actorRole));
  }

  @Post('campaigns')
  @Version('1')
  createCampaign(
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.createCampaign(
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('campaigns')
  @Version('1')
  listCampaigns(
    @Query('projectId') projectId: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listCampaigns(projectId, actorFromHeaders(actorId, actorRole));
  }

  @Get('campaigns/:id')
  @Version('1')
  getCampaign(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.getCampaign(id, actorFromHeaders(actorId, actorRole));
  }

  @Post('campaigns/:id/reference-runs')
  @Version('1')
  startReferenceRun(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.startReferenceRun(
      id,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('campaigns/:id/transitions')
  @Version('1')
  transitionCampaign(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('if-match') expectedVersion?: string,
  ) {
    return this.campaigns.transitionCampaign(
      id,
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
      requireExpectedVersion(expectedVersion),
    );
  }

  @Get('campaigns/:id/workflow')
  @Version('1')
  getWorkflowRecord(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.getWorkflowRecord(id, actorFromHeaders(actorId, actorRole));
  }

  @Get('campaigns/:id/events')
  @Version('1')
  listEvents(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listEvents(id, actorFromHeaders(actorId, actorRole));
  }

  @Get('projects/:id/artifacts')
  @Version('1')
  listArtifacts(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listArtifacts(id, actorFromHeaders(actorId, actorRole));
  }

  @Get('projects/:id/artifacts/:digest')
  @Version('1')
  async downloadArtifact(
    @Param('id') id: string,
    @Param('digest') digest: string,
    @Res() response: Response,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ): Promise<void> {
    const downloaded = await this.campaigns.getArtifactBytes(
      id,
      digest,
      actorFromHeaders(actorId, actorRole),
    );
    response.setHeader('content-type', downloaded.artifact.mediaType);
    response.setHeader('content-length', downloaded.bytes.byteLength);
    response.setHeader(
      'content-disposition',
      `attachment; filename="${downloaded.artifact.artifactId}"`,
    );
    response.setHeader('x-content-digest', downloaded.artifact.digest);
    response.send(downloaded.bytes);
  }

  @Get('campaigns/:id/evidence')
  @Version('1')
  listEvidence(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listEvidence(id, actorFromHeaders(actorId, actorRole));
  }

  @Post('campaigns/:id/evidence')
  @Version('1')
  createCampaignEvidence(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.campaigns.createCampaignEvidence(
      id,
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('campaigns/:id/verification-reports')
  @Version('1')
  listVerificationReports(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listVerificationReports(id, actorFromHeaders(actorId, actorRole));
  }

  @Get('campaigns/:id/reproducibility-bundles')
  @Version('1')
  listReproducibilityBundles(
    @Param('id') id: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listReproducibilityBundles(id, actorFromHeaders(actorId, actorRole));
  }

  @Sse('campaigns/:id/stream')
  @Version('1')
  async streamEvents(
    @Param('id') id: string,
    @Query('actorId') actorId: string | undefined,
    @Query('actorRole') actorRole: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    const history = (await this.campaigns.listEvents(id, actorFromHeaders(actorId, actorRole))).map(
      (event) => this.toMessageEvent(event),
    );
    const live = fromEvent<DomainEvent>(
      this.campaigns.eventStore().eventEmitter,
      'domain-event',
    ).pipe(
      filter((event) => event.campaignId === id),
      map((event) => this.toMessageEvent(event)),
    );
    return concat(from(history), live);
  }

  @Post('campaigns/:id/approval-requests')
  @Version('1')
  createApprovalRequest(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.createApprovalRequest(
      id,
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('approval-requests')
  @Version('1')
  listApprovalRequests(
    @Query('campaignId') campaignId: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('x-actor-role') actorRole: string | undefined,
  ) {
    return this.campaigns.listApprovalRequests(campaignId, actorFromHeaders(actorId, actorRole));
  }

  @Post('approval-requests/:id/decisions')
  @Version('1')
  decideApproval(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-actor-id') actorId?: string,
    @Headers('x-actor-role') actorRole?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaigns.decideApproval(
      id,
      body,
      actorFromHeaders(actorId, actorRole),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  private toMessageEvent(event: DomainEvent): MessageEvent {
    return { id: event.eventId, type: event.eventType, data: event };
  }
}
