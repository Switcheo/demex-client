import BigNumber from 'bignumber.js'
import { Fill, MarketParams, Order, Position } from '../types'
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

export function toHumanQuantity(quantity: string, decimals: number): number {
  return new BigNumber(quantity).shiftedBy(-decimals).toNumber()
}

export function humanizeOrder(o: any, marketParams: MarketParams): Order {
  const order = {
    ...o,
    price: toHumanPrice(o.price, marketParams),
    quantity: toHumanQuantity(o.quantity, marketParams.basePrecision),
    available: toHumanQuantity(o.available, marketParams.basePrecision),
    filled: toHumanQuantity(o.filled, marketParams.basePrecision),
    stop_price: toHumanPrice(o.stop_price, marketParams),
    avg_filled_price: toHumanPrice(o.avg_filled_price, marketParams),
    allocated_margin_amount: toHumanQuantity(o.allocated_margin_amount, 18),
  }
  return order
}
export function humanizePosition(p: any, marketParams: MarketParams): Position {
  const position = {
    ...p,
    realized_pnl: toHumanQuantity(p.realized_pnl, 18),
    max_lots: toHumanQuantity(p.max_lots, marketParams.basePrecision),
    total_fee_amount: toHumanQuantity(p.total_fee_amount, 18),
    avg_allocated_margin: toHumanQuantity(p.avg_allocated_margin, 18),
    avg_entry_price: toHumanPrice(p.avg_entry_price, marketParams),
    avg_exit_price: toHumanPrice(p.avg_exit_price, marketParams),
    allocated_margin: toHumanQuantity(p.allocated_margin, 18),
    lots: toHumanQuantity(p.lots, marketParams.basePrecision),
  }
  return position
}

export function humanizeFill(f: any, marketParams: MarketParams): Fill {
  const fill = {
    ...f,
    quantity: toHumanQuantity(f.quantity, marketParams.basePrecision),
    price: toHumanPrice(f.price, marketParams),
    fee_amount: toHumanQuantity(f.fee_amount, 18),
  }
  return fill
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
