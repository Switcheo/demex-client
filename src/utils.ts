import BigNumber from 'bignumber.js'
import {
  Fill,
  MarketParams,
  Order,
  PerpMarketParams,
  Position,
  Trade,
  UserFill,
} from './types'

export function sleep(interval: number = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, interval)
  })
}

export function toHumanPrice(
  price: string,
  params: MarketParams | PerpMarketParams
): number {
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
  return snakeToCamel(order)
}
export function humanizePosition(p: any, marketParams: MarketParams): Position {
  const market = marketParams.displayName.split('_')[0]
  const position = {
    ...p,
    market,
    realized_pnl: toHumanQuantity(p.realized_pnl, 18),
    max_lots: toHumanQuantity(p.max_lots, marketParams.basePrecision),
    total_fee_amount: toHumanQuantity(p.total_fee_amount, 18),
    avg_allocated_margin: toHumanQuantity(p.avg_allocated_margin, 18),
    avg_entry_price: toHumanPrice(p.avg_entry_price, marketParams),
    avg_exit_price: toHumanPrice(p.avg_exit_price, marketParams),
    allocated_margin: toHumanQuantity(p.allocated_margin, 18),
    lots: toHumanQuantity(p.lots, marketParams.basePrecision),
  }
  return snakeToCamel(position)
}

export function humanizeFill(f: any, marketParams: MarketParams): Trade {
  // console.log(f, marketParams)
  const fill = {
    ...f,
    quantity: toHumanQuantity(f.quantity, marketParams.basePrecision),
    price: toHumanPrice(f.price, marketParams),
    fee_amount: toHumanQuantity(f.fee_amount, 18),
    // taker_fee_amount: toHumanQuantity(f.taker_fee_amount, 18),
    // taker_fee_kickback: toHumanQuantity(f.taker_fee_kickback, 18),
    // taker_fee_commission: toHumanQuantity(f.taker_fee_commission, 18),
    // maker_fee_amount: toHumanQuantity(f.maker_fee_amount, 18),
    // maker_fee_kickback: toHumanQuantity(f.maker_fee_kickback, 18),
    // maker_fee_commission: toHumanQuantity(f.maker_fee_commission, 18),
  }
  return snakeToCamel(fill)
}
export function humanizeUserFill(
  f: any,
  marketParams: MarketParams,
  address: string
): UserFill {
  const { id, market, quantity, price, block_height, block_created_at, taker_fee_denom } =
    f
  let side = f.taker_side
  let fee_amount = f.taker_fee_amount
  if (address === f.maker_address) {
    side = f.maker_side
    fee_amount = f.maker_fee_amount
  }
  const fill = {
    id,
    market,
    quantity: toHumanQuantity(quantity, marketParams.basePrecision),
    price: toHumanPrice(price, marketParams),
    side,
    address,
    fee_denom: taker_fee_denom,
    fee_amount: toHumanQuantity(fee_amount, 18),
    block_height: parseInt(block_height),
    block_created_at,
  }
  return snakeToCamel(fill)
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

export function snakeToCamel(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel)
  }

  return Object.keys(obj).reduce((acc, key) => {
    const camelKey = key.replace(/_(\w)/g, (_, letter) => letter.toUpperCase())
    acc[camelKey] = snakeToCamel(obj[key])
    return acc
  }, {})
}
