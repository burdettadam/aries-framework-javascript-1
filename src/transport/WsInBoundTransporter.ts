import type { Agent } from '../agent/Agent'
import type { Logger } from '../logger'
import type { TrustPingMessageOptions } from '../modules/connections/messages/TrustPingMessage'
import type { ConnectionRecord } from '../modules/connections/repository/ConnectionRecord'
import type { InboundTransporter } from './InboundTransporter'

import { MessageSender } from '../agent/MessageSender'
import { createOutboundMessage } from '../agent/helpers'
import { InjectionSymbols } from '../constants'
import { ReturnRouteTypes } from '../decorators/transport/TransportDecorator'
import { TrustPingMessage } from '../modules/connections/messages/TrustPingMessage'
import WebSocket from 'ws'
import { OutboundMessage } from '../types'
import { TransportService } from '../agent/TransportService'
import { AriesFrameworkError } from '../error/AriesFrameworkError'

export class WsInboundTransporter implements InboundTransporter {
  private agent: Agent
  private logger: Logger
  public supportedSchemes = ['ws', 'wss']
  private mediatorSocket: WebSocket | null = null
  private mediatorEndpoint = ''
  private messageSender: MessageSender
  private transportService: TransportService
  public constructor(agent: Agent) {
    this.agent = agent
    this.logger = agent.injectionContainer.resolve(InjectionSymbols.Logger)
    this.messageSender = agent.injectionContainer.resolve(MessageSender)
    this.transportService = agent.injectionContainer.resolve(TransportService)
  }
  public async start() {
    /** nothing to see here*/
    const defaultMediator = await this.agent.mediationRecipient.findDefaultMediatorConnection()
    if (defaultMediator) {
      // TODO: update with batch pickup protocol.
      this.trustPingSocket(defaultMediator)
    }
  }
  public async stop() {
    this.mediatorSocket?.close()
  }

  public async trustPingSocket(connection: ConnectionRecord, options?: TrustPingMessageOptions): Promise<void> {
    const outboundMessage = await this.preparePing(connection, options)
    await this.messageSender.sendMessage(outboundMessage)
  }

  public async preparePing(connection: ConnectionRecord, options?: TrustPingMessageOptions) {
    const message = new TrustPingMessage(options)
    const outboundMessage = createOutboundMessage(connection, message)
    outboundMessage.payload.setReturnRouting(ReturnRouteTypes.all)
    return outboundMessage
  }

  public createMediatorSocket(invitationURL: string) {
    this.mediatorEndpoint = invitationURL.split('?')[0] // must be invitation from default mediator
    const socket = new WebSocket(this.mediatorEndpoint)
    socket.onmessage = (event) => {
      this.logger.trace('Socket, Message received from mediator:', (event).data)
      const payload = JSON.parse(Buffer.from(event.data).toString('utf-8'))
      this.logger.debug('Payload received from mediator:', payload)
      this.agent.receiveMessage(payload)
    }
    socket.onerror = (error) => {
      this.logger.debug('Socket ERROR', error)
    }
    socket.onopen = async () => {
      this.logger.trace('Socket has been opened')
      const mediator = await this.agent.mediationRecipient.findDefaultMediatorConnection()
      if (mediator) {
        this.logger.debug('Mediator connection record being used:', mediator)
        const ping = await this.preparePing(mediator, { responseRequested: false })
        this.logger.trace('Sending ping to socket with mediator connection encryption:', ping)
        const packed = await this.packOutBoundMessage(ping)
        if (packed) {
          this.logger.debug('Ping Packed for mediator being sent over socket:', packed.payload)
          const messageBuffer = Buffer.from(JSON.stringify(packed.payload))
          socket.send(messageBuffer)
        }
      }
    }
    socket.onclose = () => {
      this.logger.debug('Socket closed')
      // TODO: do attempt timeout, or something
      this.createMediatorSocket(invitationURL)
    }
    this.mediatorSocket = socket
  }

  public async packOutBoundMessage(outboundMessage: OutboundMessage) {
    const { connection, payload } = outboundMessage
    const { id, verkey, theirKey } = connection
    const message = payload.toJSON()
    this.logger.debug('Send outbound message', {
      messageId: message.id,
      connection: { id, verkey, theirKey },
    })

    const services = this.transportService.findDidCommServices(connection)
    if (services.length === 0) {
      throw new AriesFrameworkError(`Connection with id ${connection.id} has no service!`)
    }

    for await (const service of services) {
      this.logger.debug(`Preparing outbound message to service:`, { messageId: message.id, service })
      try {
        const keys = {
          recipientKeys: service.recipientKeys,
          routingKeys: service.routingKeys || [],
          senderKey: connection.verkey,
        }
        const outboundPackage = await this.messageSender.packMessage(outboundMessage, keys)
        outboundPackage.endpoint = service.serviceEndpoint
        outboundPackage.responseRequested = outboundMessage.payload.hasReturnRouting()
        return outboundPackage
      } catch (error) {
        this.logger.debug(
          `Preparing outbound message to service with id ${service.id} failed with the following error:`,
          {
            message: error.message,
            error: error,
          }
        )
      }
    }
  }
}
