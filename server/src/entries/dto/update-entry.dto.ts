import { PartialType } from '@nestjs/mapped-types'
import { CreateEntryDto } from './create-entry.dto'

/**
 * PATCH /entries/:id body: every field from CreateEntryDto, but optional.
 * Fields that are provided are still validated with the same rules as
 * create (e.g. `shape` must still be one of the three known values, `media`
 * must still be exactly 3 strings if present at all).
 */
export class UpdateEntryDto extends PartialType(CreateEntryDto) {}
