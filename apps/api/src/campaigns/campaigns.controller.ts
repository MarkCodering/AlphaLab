import type { MessageEvent } from '@nestjs/common';
import { Body, Controller, Get, Headers, Param, Post, Query, Sse, Version } from '@nestjs/common';
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
  listProjects(@Query('organizationId') organizationId?: string) {
    return this.campaigns.listProjects(organizationId);
  }

  @Get('projects/:id')
  @Version('1')
  getProject(@Param('id') id: string) {
    return this.campaigns.getProject(id);
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
  listTargets(@Query('projectId') projectId?: string) {
    return this.campaigns.listTargets(projectId);
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
  listCampaigns(@Query('projectId') projectId?: string) {
    return this.campaigns.listCampaigns(projectId);
  }

  @Get('campaigns/:id')
  @Version('1')
  getCampaign(@Param('id') id: string) {
    return this.campaigns.getCampaign(id);
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

  @Get('campaigns/:id/events')
  @Version('1')
  listEvents(@Param('id') id: string) {
    return this.campaigns.listEvents(id);
  }

  @Sse('campaigns/:id/stream')
  @Version('1')
  async streamEvents(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    const history = (await this.campaigns.listEvents(id)).map((event) =>
      this.toMessageEvent(event),
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
  listApprovalRequests(@Query('campaignId') campaignId?: string) {
    return this.campaigns.listApprovalRequests(campaignId);
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
