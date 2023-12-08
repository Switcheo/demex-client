<div align="center">
  <img height="120x" src="https://raw.githubusercontent.com/Switcheo/token-icons/main/demex/demex_color.png" />

  <h1 style="margin-top:20px;">Demex Client</h1>

  <p>
    <a href="https://discord.com/channels/738816874720133172/763588653116555294"><img alt="Discord Chat" src="https://img.shields.io/discord/738816874720133172?color=3e35ff" /></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-3e35ff" /></a>
  </p>
</div>

# Demex Client

This is a typescript client that wraps around carbon-js-sdk that aims to proivde a simple way to programmatically trade on Carbon's Perpetuals markets.

> Spot market trading is not fully supported on this client at the moment.

## Warning

This client is considered Alpha software and is under develpoment at the moment. Client may contain bugs and hence use at your own risk.

## Features

- [ ] Order submission with human readable inputs with tick and lot sizes rounding
- [ ] Transform outputs to human readable values
- [ ] Deals only with human friendly tickers instead of market ids (e.g. "ETH" -> "cmkt/117")
- [ ] Dead man's switch for chain and indexer liveliness
- [ ] Virtualization of user account state via websockets
- [ ] Virtualization of market data state via websockets
- [ ] Funding rate caculations
- [ ] Deposits and withdrawls functionality

### Examples

WIP
