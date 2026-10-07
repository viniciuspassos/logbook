import { IsNotEmpty, IsString } from 'class-validator'

/** Validated request body for POST /auth/google: the ID token Google Identity Services handed the browser. */
export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string
}
