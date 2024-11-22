import * as http from 'http'
import * as core from '@actions/core'
import { HttpClient, HttpClientResponse } from '@actions/http-client'
import {
  RequestHandler,
  RequestInfo
} from '@actions/http-client/lib/interfaces'
import { sign, SignOptions } from 'jsonwebtoken'
import { plainToInstance } from 'class-transformer'
import {
  AppStoreConnectApiAudience,
  AppStoreConnectApiAuthConfig,
  AppStoreConnectApiBaseURL,
  ProfileType,
  Profiles,
  ProfilesResponse
} from './models'

class AppStoreConnectRequestHandler implements RequestHandler {
  private authConfig: AppStoreConnectApiAuthConfig
  private scope?: string[]

  constructor(authConfig: AppStoreConnectApiAuthConfig, scope?: string[]) {
    this.authConfig = authConfig
    this.scope = scope
  }

  prepareRequest(options: http.RequestOptions): void {
    if (!options.headers) {
      options.headers = {}
    }
    // TODO: Consider not generating a new token for each request to avoid rate limiting
    const token = generateJWTToken(
      this.authConfig,
      1200, // 20 minutes (Max allowed by App Store Connect API)
      this.scope
    )
    options.headers['Authorization'] = `Bearer ${token}`
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandleAuthentication(response: HttpClientResponse): boolean {
    // This handler does not handle authentication challenges
    return false
  }

  async handleAuthentication(
    httpClient: HttpClient, // eslint-disable-line @typescript-eslint/no-unused-vars
    requestInfo: RequestInfo, // eslint-disable-line @typescript-eslint/no-unused-vars
    data: string | NodeJS.ReadableStream | null // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HttpClientResponse> {
    // Since this handler does not handle authentication challenges, just return a rejected promise
    return Promise.reject(
      new Error('JWT RequestHandler does not support authentication challenges')
    )
  }
}

/**
 * Generates a JWT token for authenticating with the App Store Connect API
 * @param authConfig - The App Store Connect API authentication configuration
 * @param expiresAfter - Token expiration time in seconds (default 1200/20min, max allowed)
 * @param scope - Array of API endpoint scopes to request access to (e.g. ['GET /v1/profiles'])
 * @returns The generated JWT token string
 */
function generateJWTToken(
  authConfig: AppStoreConnectApiAuthConfig,
  expiresAfter: number,
  scope?: string[]
): string {
  // *SECURITY* Ensure the key is never accidentally exposed in any logs.
  core.setSecret(authConfig.key)
  // *END SECURITY*

  core.info('Generating JWT token')
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: authConfig.issuerId,
    aud: authConfig.audience,
    exp: now + expiresAfter,
    iat: now,
    ...(scope && { scope: scope }) // Add scope only if it is provided
  }
  core.debug(`JWT payload: ${JSON.stringify(payload, null, 2)}`)

  const options: SignOptions = {
    algorithm: 'ES256',
    keyid: authConfig.keyId
  }
  core.debug(`JWT options: ${JSON.stringify(options, null, 2)}`)

  // *SECURITY* Ensure the token is never accidentally exposed in any logs.
  const token = sign(payload, authConfig.key, options)
  core.setSecret(token)
  // *END SECURITY*
  return token
}

/**
 * Fetches provisioning profiles from the App Store Connect API.
 * This function makes a direct HTTP request to the profiles endpoint.
 *
 * @param ascIssuerId - The App Store Connect API issuer ID for authentication
 * @param ascKeyId - The App Store Connect API key ID for authentication
 * @param ascKeyContent - The base64-encoded private key content for App Store Connect API authentication
 * @returns A Promise that resolves when the profiles have been fetched
 */
export async function fetchProvisioningProfiles(
  authConfig: AppStoreConnectApiAuthConfig,
  profileTypes: ProfileType[]
): Promise<Profiles> {
  const httpClient = new HttpClient(undefined, [
    new AppStoreConnectRequestHandler(authConfig, [
      'GET /v1/profiles',
      'GET /v1/profiles?filter[profileState]=ACTIVE',
      `GET /v1/profiles?filter[profileState]=ACTIVE&filter[profileType]=${profileTypes.map(type => type.toString()).join(',')}`
    ])
  ])

  const baseURL =
    authConfig.audience === AppStoreConnectApiAudience.AppStore
      ? AppStoreConnectApiBaseURL.AppStore
      : AppStoreConnectApiBaseURL.Enterprise
  const url = `${baseURL}/v1/profiles?filter[profileState]=ACTIVE&filter[profileType]=${profileTypes.map(type => type.toString()).join(',')}`
  const profiles: Profiles = new Profiles()

  async function fetchProfiles(url: string): Promise<ProfilesResponse> {
    core.debug(`Fetching profiles from ${url}`)
    return httpClient
      .get(url)
      .then(async (response: HttpClientResponse) => {
        core.debug(`Response status: ${response.message.statusCode}`)
        return response.readBody()
      })
      .then((body: string) => {
        const profilesResponse: ProfilesResponse = plainToInstance(
          ProfilesResponse,
          JSON.parse(body),
          { excludeExtraneousValues: true }
        )
        profiles.push(...profilesResponse.profiles)
        core.info(
          `Fetched ${profiles.length} out of ${profilesResponse.meta.paging.total} profiles`
        )
        return profilesResponse
      })
      .catch((err: Error) => {
        throw new Error(
          `Failed to fetch provisioning profiles: ${err.message}`,
          {
            cause: err
          }
        )
      })
  }

  const response = await fetchProfiles(url)
  let nextURL = response.links.next
  while (nextURL !== undefined) {
    const nestedResponse = await fetchProfiles(nextURL)
    nextURL = nestedResponse.links.next
  }

  core.debug(`Profiles: ${JSON.stringify(profiles, null, 2)}`)
  core.info(`Total profiles fetched: ${profiles.length}`)
  return profiles
}
