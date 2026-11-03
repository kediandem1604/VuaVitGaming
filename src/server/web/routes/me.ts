/** Hồ sơ của người đang đăng nhập. */

import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MeDto } from '../../../shared/api-types.js';
import { updateProfile } from '../../modules/members/service.js';
import { currentMember, requireMember } from '../auth-plugin.js';

const profilePatchBody = z
  .object({
    email: z.string().nullable().optional(),
    notifyEmail: z.boolean().optional(),
    notifyDm: z.boolean().optional(),
  })
  .strict();

export function toMeDto(m: Member): MeDto {
  return {
    id: m.id,
    memberCode: m.memberCode,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    email: m.email,
    notifyEmail: m.notifyEmail,
    notifyDm: m.notifyDm,
    accessLevel: m.accessLevel,
  };
}

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', { preHandler: requireMember }, async (request) => toMeDto(currentMember(request)));

  app.patch('/api/me', { preHandler: requireMember }, async (request) => {
    const patch = profilePatchBody.parse(request.body);
    return toMeDto(await updateProfile(app.ctx, currentMember(request).id, patch));
  });
}
