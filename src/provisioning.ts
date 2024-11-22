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
  private expiresAfter: number
  private scope?: string[]
  private token: string

  constructor(
    authConfig: AppStoreConnectApiAuthConfig,
    expiresAfter: number,
    scope?: string[]
  ) {
    this.authConfig = authConfig
    this.expiresAfter = expiresAfter
    this.scope = scope
    this.token = generateJWTToken(
      this.authConfig,
      this.expiresAfter,
      this.scope
    )
  }

  /**
   * Prepares the HTTP request by adding the JWT bearer token to the Authorization header.
   * This is called automatically by the HttpClient before making each request.
   *
   * @param options - The HTTP request options to modify
   */
  prepareRequest(options: http.RequestOptions): void {
    if (!options.headers) {
      options.headers = {}
    }
    options.headers['Authorization'] = `Bearer ${this.token}`
  }

  /**
   * Determines if this handler can handle authentication for the given response.
   * Returns true for 401 (Unauthorized), 403 (Forbidden), and 429 (Rate Limit) status codes
   * which indicate the request failed due to authentication/authorization issues.
   *
   * @param response - The HTTP response from the failed request
   * @returns true if this handler can handle the authentication failure, false otherwise
   */
  canHandleAuthentication(response: HttpClientResponse): boolean {
    switch (response.message.statusCode) {
      case 401: // Unauthorized
      case 403: // Forbidden
      case 429: // Rate limit exceeded
        return true
      default:
        return false
    }
  }

  /**
   * Handles authentication failures by generating a new JWT token and retrying the failed request.
   * This is called automatically by the HttpClient when a request fails with a 401, 403, or 429 status code.
   *
   * @param httpClient - The HttpClient instance making the request
   * @param requestInfo - Information about the failed request including URL and options
   * @param data - The request body data, if any
   * @returns A Promise that resolves with the response from retrying the request
   */
  async handleAuthentication(
    httpClient: HttpClient,
    requestInfo: RequestInfo,
    data: string | NodeJS.ReadableStream | null
  ): Promise<HttpClientResponse> {
    // Generate a new token and retry the request once
    core.warning(
      'Authentication failed, generating new token and retrying request'
    )
    this.token = generateJWTToken(
      this.authConfig,
      this.expiresAfter,
      this.scope
    )

    // Retry the request with new token
    this.prepareRequest(requestInfo.options)
    return httpClient.requestRaw(requestInfo, data)
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
  const profileTypeFilter = profileTypes.map(type => type.toString()).join(',')
  const httpClient = new HttpClient(undefined, [
    new AppStoreConnectRequestHandler(
      authConfig,
      1200, // 20 minutes (Max allowed by App Store Connect API)
      [
        'GET /v1/profiles',
        'GET /v1/profiles?filter[profileState]=ACTIVE',
        `GET /v1/profiles?filter[profileState]=ACTIVE&filter[profileType]=${profileTypeFilter}`
      ]
    )
  ])

  const baseURL =
    authConfig.audience === AppStoreConnectApiAudience.AppStore
      ? AppStoreConnectApiBaseURL.AppStore
      : AppStoreConnectApiBaseURL.Enterprise
  const url = `${baseURL}/v1/profiles?filter[profileState]=ACTIVE&filter[profileType]=${profileTypeFilter}`
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
