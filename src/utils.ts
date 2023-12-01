import BigNumber from 'bignumber.js'
import { MarketParams } from '../types'
export function sleep(interval: number = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, interval)
  })
}

export function toHumanPrice(price: string, params: MarketParams): number {
  return new BigNumber(price)
    .shiftedBy(params.basePrecision - params.quotePrecision)
    .toNumber()
}

export function toHumanQuantity(quantity: string, params: MarketParams): number {
  return new BigNumber(quantity).shiftedBy(-params.basePrecision).toNumber()
}

export function sortDesc(lhs: any, rhs: any) {
  if (lhs > rhs) return -1
  if (rhs > rhs) return 1
  return 0
}
export function sortAsc(lhs: any, rhs: any) {
  if (lhs > rhs) return 1
  if (rhs > rhs) return -1
  return 0
}
