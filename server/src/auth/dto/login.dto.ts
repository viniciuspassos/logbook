import { IsNotEmpty, IsString } from 'class-validator'

/** Validated request body for POST /auth/login. Single-user, so no username field. */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  password!: string
}
