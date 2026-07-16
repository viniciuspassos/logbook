import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'
import { ADVENTURE_SHAPES, type AdventureShape } from '../entry.entity'

/**
 * Validated request body for POST /entries. Mirrors src/types/entry.ts field
 * for field (minus `id`, which the server generates) — this DTO is defined
 * independently of the frontend package, not imported from it.
 */
export class CreateEntryDto {
  @IsString()
  @IsNotEmpty()
  title!: string

  @IsIn(ADVENTURE_SHAPES)
  shape!: AdventureShape

  @IsOptional()
  @IsString()
  activityType?: string

  @IsString()
  @IsNotEmpty()
  location!: string

  @IsString()
  @IsNotEmpty()
  date!: string

  @IsString()
  metric!: string

  @IsString()
  excerpt!: string

  @IsString()
  weather!: string

  @IsString()
  duration!: string

  @IsString()
  difficulty!: string

  @IsString()
  equipment!: string

  @IsString()
  participants!: string

  @IsString()
  raw!: string

  @IsString()
  story!: string

  @IsString()
  photoHint!: string

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  media!: [string, string, string]

  @IsNumber()
  @Min(0)
  @Max(100)
  mapX!: number

  @IsNumber()
  @Min(0)
  @Max(100)
  mapY!: number
}
