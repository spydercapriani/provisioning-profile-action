import 'reflect-metadata'
import * as core from '@actions/core'
import { plainToInstance } from 'class-transformer'
import { fetchProvisioningProfiles } from './provisioning'
import { AppStoreConnectApiAuthConfig, ProfileType } from './models'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  const appStoreConnectAuthConfig: AppStoreConnectApiAuthConfig =
    plainToInstance(
      AppStoreConnectApiAuthConfig,
      JSON.parse(
        core.getInput('appstore-connect-json', {
          required: true
        })
      )
    )
  core.debug(`ASC - Issuer ID: ${appStoreConnectAuthConfig.issuerId}`)
  core.debug(`ASC - Key ID: ${appStoreConnectAuthConfig.keyId}`)
  core.debug(`ASC - Audience: ${appStoreConnectAuthConfig.audience}`)

  const defaultProfileTypes: ProfileType[] = [
    ProfileType.iOSAppDevelopment,
    ProfileType.iOSAppStore,
    ProfileType.iOSAppAdhoc,
    ProfileType.iOSAppInHouse
  ]

  // Validate the profile types
  const profileTypes = (
    core.getMultilineInput('profile-types', { required: false }) ||
    defaultProfileTypes
  ).map(type => ProfileType.fromString(type.trim()))
  core.debug(`Profile Types: ${JSON.stringify(profileTypes, null, 2)}`)

  if (profileTypes.length === 0) {
    core.setFailed('No valid profile types provided.')
  }

  try {
    core.startGroup('Fetching Provisioning Profiles')
    const profiles = await fetchProvisioningProfiles(
      appStoreConnectAuthConfig,
      profileTypes
    )
    core.endGroup()

    // Leverage the runner's temp directory when testing locally, otherwise use the runner's home directory
    const provisioningProfilesDirectory =
      `${process.env.GITHUB_ACTIONS}` === 'false'
        ? `${process.env.RUNNER_TEMP}/Provisioning Profiles`
        : `${process.env.HOME}/Library/MobileDevice/Provisioning Profiles`

    core.startGroup('Saving Provisioning Profiles')
    const createdProfiles = await Promise.all(
      profiles
        .filter(profile => !profile.isExpired())
        .map(async profile => {
          core.info(
            `Saving provisioning profile ${profile.name} to ${provisioningProfilesDirectory}`
          )
          return profile.saveTo(provisioningProfilesDirectory)
        })
    )
    core.info(`Saved ${createdProfiles.length} provisioning profiles`)
    core.endGroup()

    core.setOutput('profiles', JSON.stringify(createdProfiles, null, 2))
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
