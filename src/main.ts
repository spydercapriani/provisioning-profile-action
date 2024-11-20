import * as core from '@actions/core'
import {
  getAllProvisioningProfiles,
  saveProvisioningProfiles
} from './provisioning'
import { ProfilesGetCollectionFilterProfileTypeEnum } from 'appstore-connect-sdk/dist/openapi'

// Function to check if a value is a valid enum member
function isValidProfileType(
  type: string
): type is ProfilesGetCollectionFilterProfileTypeEnum {
  return Object.values(ProfilesGetCollectionFilterProfileTypeEnum).includes(
    type as ProfilesGetCollectionFilterProfileTypeEnum
  )
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  const ascIssuerId = core.getInput('appstore-connect-api-issuer-id', {
    required: true
  })
  const ascKeyId = core.getInput('appstore-connect-api-key-id', {
    required: true
  })
  const ascKeyContent = core.getInput('appstore-connect-api-key-content', {
    required: true
  })
  // *SECURITY* Hide the API key content from the logs
  core.setSecret(ascKeyContent)

  const defaultProfileTypes: ProfilesGetCollectionFilterProfileTypeEnum[] = [
    'IOS_APP_DEVELOPMENT',
    'IOS_APP_STORE',
    'IOS_APP_ADHOC',
    'IOS_APP_INHOUSE'
  ]

  // Validate the profile types
  const profileTypes = (
    core.getMultilineInput('profile-types', { required: false }) ||
    defaultProfileTypes
  )
    .map(type => type.trim())
    .filter(type => isValidProfileType(type))

  if (profileTypes.length === 0) {
    core.setFailed('No valid profile types provided.')
  }

  try {
    core.startGroup('Fetching Provisioning Profiles')
    const profiles = await getAllProvisioningProfiles(
      profileTypes,
      ascIssuerId,
      ascKeyId,
      ascKeyContent
    )
    core.endGroup()

    // Leverage the runner's temp directory when testing locally, otherwise use the runner's home directory
    const provisioningProfilesDirectory =
      `${process.env.GITHUB_ACTIONS}` === 'false'
        ? `${process.env.RUNNER_TEMP}/Provisioning Profiles`
        : `${process.env.HOME}/Library/MobileDevice/Provisioning Profiles`

    core.startGroup('Saving Provisioning Profiles')
    const createdProfiles = await saveProvisioningProfiles(
      profiles,
      provisioningProfilesDirectory
    )
    core.info(`Loaded ${createdProfiles.length} provisioning profiles`)
    core.debug(`profiles: ${JSON.stringify(createdProfiles, null, 2)}`)
    core.endGroup()

    core.setOutput('profiles', JSON.stringify(createdProfiles, null, 2))
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
