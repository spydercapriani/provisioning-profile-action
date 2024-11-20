import * as core from '@actions/core'
import AppStoreConnectAPI from 'appstore-connect-sdk'
import {
  ProfileAttributes,
  ProfilesApi,
  ProfilesGetCollectionFilterProfileTypeEnum
} from 'appstore-connect-sdk/dist/openapi'
import * as fs from 'fs'
import * as path from 'path'

export async function getAllProvisioningProfiles(
  profileTypes: ProfilesGetCollectionFilterProfileTypeEnum[],
  ascIssuerId: string,
  ascKeyId: string,
  ascKeyContent: string
): Promise<ProfileAttributes[]> {
  core.info(
    `Fetching Provisioning Profile Types: ${JSON.stringify(profileTypes, null, 2)}`
  )

  const ascKey = Buffer.from(ascKeyContent, 'base64').toString()
  // *SECURITY* Ensure the key is never accidentally exposed in logs.
  core.setSecret(ascKey)
  // *END SECURITY*

  const client = new AppStoreConnectAPI({
    issuerId: ascIssuerId,
    privateKeyId: ascKeyId,
    privateKey: ascKey
  })
  const api = await client.create(ProfilesApi)
  const profiles = await api
    .profilesGetCollection({
      filterProfileState: ['ACTIVE'],
      filterProfileType: profileTypes
    })
    .then(res =>
      res.data
        .flatMap(profile => {
          if (profile.attributes && profile.attributes.profileContent) {
            // *SECURITY* Ensure the profile content is never accidentally exposed in logs.
            core.setSecret(profile.attributes.profileContent)
            // *END SECURITY*
          }
          return profile.attributes
        })
        .filter((attr): attr is ProfileAttributes => attr !== undefined)
    )
    .catch((err: Error) => {
      throw new Error(`Failed to fetch provisioning profiles: ${err.message}`, {
        cause: err
      })
    })

  return profiles
}

export interface ProvisioningProfile {
  uuid: string
  name: string
  path: string
}

export async function saveProvisioningProfiles(
  profiles: ProfileAttributes[],
  outputDirectory: string
): Promise<ProvisioningProfile[]> {
  core.info(
    `Saving ${profiles.length} provisioning profiles to ${outputDirectory}`
  )
  core.debug(`Profiles: ${JSON.stringify(profiles, null, 2)}`)

  const createdProfiles: ProvisioningProfile[] = []

  for (const profile of profiles) {
    // Ensure all required attributes are present
    if (
      !(
        profile.name &&
        profile.profileContent &&
        profile.platform &&
        profile.uuid
      )
    ) {
      throw new Error(
        `Profile ${JSON.stringify(profile, null, 2)} is missing required attributes`
      )
    }
    // *ADDITIONAL SAFEGUARD* Skip inactive profiles
    if (profile.profileState !== 'ACTIVE') {
      core.warning(`Skipping profile ${profile.name} because it is not active`)
      continue
    }

    const profileFileExtension =
      profile.platform == 'MAC_OS' ? 'provisionprofile' : 'mobileprovision'
    const profileFileName = `${profile.uuid}.${profileFileExtension}`
    const profileFilePath = path.join(outputDirectory, profileFileName)
    await fs.promises
      .mkdir(outputDirectory, { recursive: true })
      .catch((err: Error) => {
        throw new Error(
          `Failed to create output directory ${outputDirectory}: ${err.message}`,
          { cause: err }
        )
      })

    const buffer = Buffer.from(profile.profileContent, 'base64')
    await fs.promises.writeFile(profileFilePath, buffer).catch((err: Error) => {
      throw new Error(
        `Failed to write profile ${profile.name} to ${profileFilePath}: ${err.message}`,
        { cause: err }
      )
    })

    core.debug(
      `Created ${profile.profileType} profile ${profile.name} at ${profileFilePath}`
    )

    createdProfiles.push({
      uuid: profile.uuid,
      name: profile.name,
      path: profileFilePath
    })
  }

  return createdProfiles
}
