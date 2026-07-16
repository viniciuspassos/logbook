import { PartialType } from '@nestjs/mapped-types'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Min, ValidateNested } from 'class-validator'
import { CreateEntryDto } from './create-entry.dto'

/**
 * Shape of a losing edit a client attaches to a follow-up PATCH after
 * resolving a 409 version conflict (#24) — every CreateEntryDto field, all
 * optional, since a losing draft may only have touched a few fields. The
 * server stores this opaquely (Entry.supersededEdits) and never validates
 * its *content* against the winning edit; only its shape is checked here,
 * same as any other DTO.
 */
export class SupersededEditDto extends PartialType(CreateEntryDto) {}

/**
 * PATCH /entries/:id body: every field from CreateEntryDto, but optional,
 * plus the optimistic-concurrency fields #24 adds:
 *
 * - `version` (required): the version this edit was based on. A mismatch
 *   against the entry's current version means someone else moved on since
 *   this client last read it — the server rejects the write with 409 and
 *   the current row (see EntryVersionConflictException) rather than
 *   silently overwriting it. `updatedAt` is deliberately never used for
 *   this — see the warning on that column in entry.entity.ts.
 * - `supersededEdit` (optional): a losing draft to preserve rather than
 *   discard when this PATCH is itself resolving an earlier conflict. Only
 *   appended when this PATCH's `version` matches (i.e. the write actually
 *   happens) — a rejected PATCH never stores anything, by design.
 *
 * Other provided fields are still validated with the same rules as create
 * (e.g. `shape` must still be one of the three known values, `media` must
 * still be exactly 3 strings if present at all).
 */
export class UpdateEntryDto extends PartialType(CreateEntryDto) {
  @IsInt()
  @Min(1)
  version!: number

  @IsOptional()
  @ValidateNested()
  @Type(() => SupersededEditDto)
  supersededEdit?: SupersededEditDto
}
