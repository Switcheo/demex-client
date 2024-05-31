import BigNumber from 'bignumber.js'
import { EventEmitter } from 'events'
import { Balance, Book, Order, Position, Trade } from './types'

interface BalancesEvent {
  [denom: string]: Balance
}

interface OpenOrdersEvent {
  [market: string]: Order[]
}

interface PositionsEvent {
  [market: string]: Position
}

interface CarbonEvents {
  balances: (balances: BalancesEvent) => void
  orderbook: (market: string, orderbook: Book) => void
  openOrders: (orders: OpenOrdersEvent) => void
  positions: (positions: PositionsEvent) => void
  accountTrades: (trades: Trade[]) => void
}

export class Events extends EventEmitter {
  emit<T extends keyof CarbonEvents>(
    event: T,
    ...args: Parameters<CarbonEvents[T]>
  ): boolean {
    return super.emit(event, ...args)
  }

  on<T extends keyof CarbonEvents>(event: T, listener: CarbonEvents[T]): this {
    return super.on(event, listener)
  }
}
