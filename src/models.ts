/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import { Expose, Transform, Type } from 'class-transformer'

export enum AppStoreConnectApiAudience {
  AppStore = 'appstoreconnect-v1',
  Enterprise = 'apple-developer-enterprise-v1'
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace AppStoreConnectApiAudience {
  export function fromString(value: string): AppStoreConnectApiAudience {
    switch (value.toLowerCase()) {
      case 'appstore':
        return AppStoreConnectApiAudience.AppStore
      case 'enterprise':
        return AppStoreConnectApiAudience.Enterprise
      default:
        throw new Error(
          `Invalid App Store Connect API audience: ${value}, expected 'AppStore' or 'Enterprise'`
        )
    }
  }
}

export class AppStoreConnectApiAuthConfig {
  @Expose({ name: 'issuerId' })
  issuerId!: string

  @Expose({ name: 'keyId' })
  keyId!: string

  @Expose({ name: 'keyContent' })
  @Transform(({ value }) => {
    // *SECURITY* Hide the key from any logs
    core.setSecret(value)
    const decoded = Buffer.from(value, 'base64').toString()
    core.setSecret(decoded)
    // *END SECURITY*
    return decoded
  })
  key!: string

  @Expose({ name: 'audience' })
  @Transform(({ value }) => AppStoreConnectApiAudience.fromString(value))
  audience!: AppStoreConnectApiAudience
}

export enum AppStoreConnectApiBaseURL {
  AppStore = 'https://api.appstoreconnect.apple.com',
  Enterprise = 'https://api.enterprise.developer.apple.com'
}

export enum ProfileType {
  iOSAppDevelopment = 'IOS_APP_DEVELOPMENT',
  iOSAppStore = 'IOS_APP_STORE',
  iOSAppAdhoc = 'IOS_APP_ADHOC',
  iOSAppInHouse = 'IOS_APP_INHOUSE',
  macAppDevelopment = 'MAC_APP_DEVELOPMENT',
  macAppStore = 'MAC_APP_STORE',
  macAppDirect = 'MAC_APP_DIRECT',
  tvOSAppDevelopment = 'TVOS_APP_DEVELOPMENT',
  tvOSAppStore = 'TVOS_APP_STORE',
  tvOSAppAdhoc = 'TVOS_APP_ADHOC',
  tvOSAppInHouse = 'TVOS_APP_INHOUSE',
  macCatalystAppDevelopment = 'MAC_CATALYST_APP_DEVELOPMENT',
  macCatalystAppStore = 'MAC_CATALYST_APP_STORE',
  macCatalystAppDirect = 'MAC_CATALYST_APP_DIRECT'
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ProfileType {
  export function fromString(value: string): ProfileType {
    if (Object.values(ProfileType).includes(value as ProfileType)) {
      return value as ProfileType
    }
    throw new Error(`Invalid provisioning profile type: ${value}`)
  }
}

export class PagedDocumentLinks {
  @Expose({ name: 'self' })
  self!: string

  @Expose({ name: 'first' })
  first?: string

  @Expose({ name: 'next' })
  next?: string
}

export class Paging {
  @Expose({ name: 'total' })
  total?: number

  @Expose({ name: 'limit' })
  limit!: number
}

export class PagedDocumentMeta {
  @Expose({ name: 'paging' })
  @Type(() => Paging)
  paging!: Paging
}

export class ProfilesResponse {
  @Expose({ name: 'data' })
  @Type(() => Profile)
  profiles!: Profile[]

  @Expose({ name: 'links' })
  @Type(() => PagedDocumentLinks)
  links!: PagedDocumentLinks

  @Expose({ name: 'meta' })
  @Type(() => PagedDocumentMeta)
  meta!: PagedDocumentMeta
}

export class Profile {
  @Expose({ name: 'id' })
  id!: string

  @Expose()
  @Transform(({ obj }) => obj.attributes.uuid as string)
  uuid!: string

  @Expose()
  @Transform(({ obj }) => obj.attributes.name as string)
  name!: string

  @Expose({ name: 'attributes' })
  @Transform(({ obj }) => ProfileType.fromString(obj.attributes.profileType))
  type!: ProfileType

  @Expose()
  @Transform(({ obj }) => ProfileState.fromString(obj.attributes.profileState))
  state!: ProfileState

  @Expose()
  @Transform(({ obj }) => {
    // *SECURITY* Hide the profile content from any logs
    core.setSecret(obj.attributes.profileContent)
    // *END SECURITY*
    return Buffer.from(obj.attributes.profileContent, 'base64')
  })
  profile!: Buffer

  @Expose()
  @Transform(({ obj }) => Platform.fromString(obj.attributes.platform))
  platform!: Platform

  @Expose()
  @Transform(({ obj }) => new Date(obj.attributes.createdDate))
  createdDate!: Date

  @Expose()
  @Transform(({ obj }) => new Date(obj.attributes.expirationDate))
  expirationDate!: Date

  isExpired(): boolean {
    return this.expirationDate < new Date()
  }

  async saveTo(outputDirectory: string): Promise<InstalledProvisioningProfile> {
    const profileFileExtension =
      this.platform == Platform.MAC_OS ? 'provisionprofile' : 'mobileprovision'
    const profileFileName = `${this.uuid}.${profileFileExtension}`
    const profileFilePath = path.join(outputDirectory, profileFileName)
    return fs.promises
      .mkdir(outputDirectory, { recursive: true })
      .then(async () => {
        core.debug(
          `Saving provisioning profile ${this.name} to ${profileFilePath}`
        )
        await fs.promises.writeFile(profileFilePath, this.profile)
      })
      .then(() => {
        return {
          uuid: this.uuid,
          name: this.name,
          path: profileFilePath
        }
      })
      .catch((err: Error) => {
        throw new Error(
          `Failed to save provisioning profile ${this.name} to ${profileFilePath}: ${err.message}`,
          { cause: err }
        )
      })
  }

  toString(): string {
    return `Profile {
      id: ${this.id},
      uuid: ${this.uuid}, 
      name: ${this.name},
      type: ${this.type},
      state: ${this.state},
      platform: ${this.platform},
      createdDate: ${this.createdDate.toISOString()},
      expirationDate: ${this.expirationDate.toISOString()}
    }`
  }

  toJSON(): object {
    return {
      id: this.id,
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      state: this.state,
      platform: this.platform,
      createdDate: this.createdDate,
      expirationDate: this.expirationDate
    }
  }
}

export class Profiles extends Array<Profile> {
  toJSON(): object[] {
    return this.reduce((acc: object[], profile) => {
      acc.push(profile.toJSON())
      return acc
    }, [])
  }
}

export enum ProfileState {
  ACTIVE = 'ACTIVE',
  INVALID = 'INVALID'
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ProfileState {
  export function fromString(value: string): ProfileState {
    if (Object.values(ProfileState).includes(value as ProfileState)) {
      return value as ProfileState
    }
    throw new Error(
      `Invalid provisioning profile state: ${value}, expected 'ACTIVE' or 'INVALID'`
    )
  }
}

export enum Platform {
  IOS = 'IOS',
  MAC_OS = 'MAC_OS'
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Platform {
  export function fromString(value: string): Platform {
    if (Object.values(Platform).includes(value as Platform)) {
      return value as Platform
    }
    throw new Error(
      `Invalid provisioning profile platform: ${value}, expected 'IOS' or 'MAC_OS'`
    )
  }
}

export interface InstalledProvisioningProfile {
  uuid: string
  name: string
  path: string
}
