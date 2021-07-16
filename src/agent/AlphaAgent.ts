import type { InitConfig } from '../types'

import { Subject } from 'rxjs'
import { inject } from 'tsyringe'

import { MediationRecipientService, InjectionSymbols } from '..'
import { ConnectionService } from '../modules/connections/services'
import { RecipientModule } from '../modules/routing/RecipientModule'

import { Agent } from './Agent'
import { AgentConfig } from './AgentConfig'
import { Dispatcher } from './Dispatcher'
import { EventEmitter } from './EventEmitter'
import { MessageSender } from './MessageSender'


export class AlphaRecipient extends RecipientModule {

  public agentConfig: AgentConfig
  public constructor(
    dispatcher: Dispatcher,
    agentConfig: AgentConfig,
    mediationRecipientService: MediationRecipientService,
    connectionService: ConnectionService,
    messageSender: MessageSender,
    eventEmitter: EventEmitter,
    @inject(InjectionSymbols.$Stop) $stop: Subject<boolean>
  ) {
    super(dispatcher, agentConfig, mediationRecipientService, connectionService, messageSender, eventEmitter, $stop)
  }
  public async initialize() {
    const { defaultMediatorId, clearDefaultMediator } = this.agentConfig

    // Set default mediator by id
    if (defaultMediatorId) {
      const mediatorRecord = await this.mediationRecipientService.getById(defaultMediatorId)
      await this.mediationRecipientService.setDefaultMediator(mediatorRecord)
    }
    // Clear the stored default mediator
    else if (clearDefaultMediator) {
      await this.mediationRecipientService.clearDefaultMediator()
    }

    // Poll for messages from mediator
    const defaultMediator = await this.findDefaultMediator()
    if (defaultMediator) {
      await this.initiateMessagePickup(defaultMediator)
    }
  }
}

export class AlphaAgent extends Agent {
  public mediationRecipient!: RecipientModule

  public constructor(initialConfig: InitConfig) {
    super(initialConfig)
    this.mediationRecipient = this.container.resolve(AlphaRecipient)
    //this['mediationRecipient' as AlphaAgent['mediationRecipient']] = this.container.resolve(AlphaRecipient)
  }
}
