var assert = require('assert');

var Exchange = require('bitcoin-exchange-client');
var Helpers = Exchange.Helpers;

var BankAccount = require('./bank-account');

class Trade extends Exchange.Trade {
  constructor (obj, api, delegate) {
    super(obj, api, delegate);

    assert(obj || obj === null, 'JSON or null missing');

    this._inCurrency = 'INR';
    this._outCurrency = 'BTC';

    this._medium = 'bank';

    this._createdAt = null;

    if (obj) {
      this._id = obj.id;
      this._state = obj.state;

      this._delegate.deserializeExtraFields(obj, this);
      this._confirmed = obj.confirmed;

      this._is_buy = obj.is_buy;
    } else {
      this._is_buy = this._inCurrency === 'INR';
    }

    if (this._is_buy && Helpers.isPositiveInteger(this._account_index) && Helpers.isPositiveInteger(this._receive_index)) {
      this._receiveAddress = this._delegate.getReceiveAddress(this);
    }
  }

  setFromAPI (obj) {
    super.setFromAPI();

    /* istanbul ignore if */
    if (this.debug) {
      console.info('Trade ' + this.id + ' from Unocoin API');
    }

    this._txHash = obj.transaction_hash;
    this._id = this._id || Trade.idFromAPI(obj);

    switch (obj.status) {
      /* Unocoin API only uses 'Pending' and 'Complete'. For consistentcy we
         map these to their equivalent Coinify states. Additional fields are
         used to determine this.

         Currently the API does not support:
         * 'reviewing': we can't tell when Unocoin has received the funds
         * 'cancelled': users can't cancel a trade
         * 'rejected': not possible afaik
         * 'expired': not possible afaik
      */
      case 'Pending':
        if (obj.reference_number) {
          this._state = 'awaiting_transfer_in';
        } else {
          this._state = 'awaiting_reference_number';
        }
        break;
      case 'Approved':
        this._state = 'processing';
        break;
      case 'Completed':
        this._state = 'completed';
        break;
      default:
        this._state = 'awaiting_reference_number';
    }

    if (obj.unixtime) {
      // API returns unix timestamp when creating a trade
      this._createdAt = new Date(obj.unixtime * 1000);
    } else if (obj.requested_time) {
       // API returns date-time string when listing trades
      this._createdAt = new Date(obj.requested_time);
    } else {
      console.warn('Unexpected missing field: requested_time / unixtime');
      this._createdAt = null;
    }

    this._inAmount = obj.inr;
    this._sendAmount = this._inAmount;

    this._outAmount = null;
    this._outAmountExpected = null;

    if (obj.btc && obj.btc !== '' && obj.btc !== '0') {
      if (this.state !== 'completed') {
        this._outAmountExpected = parseFloat(obj.btc) * 100000000.0;
      } else {
        this._outAmount = parseFloat(obj.btc) * 100000000.0;
        this._outAmountExpected = this._outAmount;
      }
    } else if (this._delegate.ticker) {
      this._outAmountExpected = Math.round(this._inAmount / this._delegate.ticker.buy.price * 100000000);
    }
  }

  get isBuy () {
    return this._is_buy;
  }

  static buy (quote, medium) {
    const request = (receiveAddress) => {
      return quote.api.authPOST('api/blockchain-v1/trading/instant_buyingbtc', {
        destination: receiveAddress,
        amount: quote.baseCurrency === 'INR' ? -quote.baseAmount : quote.quoteAmount
      }).then((res) => {
        if (res.status_code === 200) {
          return res;
        } else {
          return Promise.reject(res.message);
        }
      });
    };
    return super.buy(quote, medium, request);
  }

  static fetchAll (api) {
    return api.authGET('api/blockchain-v1/wallet/deposit_history').then(res => {
      switch (res.status_code) {
        case 200:
          return res.transactions;
        case 716: // Transaction not found (pending API fix)
          return [];
        default:
          return Promise.reject(res.message);
      }
    });
  }

  // Fetches all, but only updates the current trade
  refresh () {
    let self = this;

    const process = (res) => {
      let transaction = res.find((tx) => Trade.idFromAPI(tx) === self.id);
      if (!transaction) {
        console.error('Unuable to find matching transaction in result');
        return Promise.reject('TX_NOT_FOUND');
      }
      self.setFromAPI(transaction);
    };

    return Trade.fetchAll(this._api)
      .then(process)
      .then(this._delegate.save.bind(this._delegate))
      .then(() => self);
  }

  addReferenceNumber (ref) {
    let processResult = (res) => {
      if (res.status_code === 200) {
        this._state = 'awaiting_transfer_in';
        return Promise.resolve();
      } else {
        console.error('Failed to set reference number', res.status_code, res.message);
        return Promise.reject(res.message);
      }
    };
    return this._api.authPOST('api/blockchain-v1/wallet/add_reference', {
      inr_transaction_id: this._id,
      ref_num: ref
    })
      .then(processResult)
      .then(this._delegate.save.bind(this._delegate))
      .then(this.self.bind(this));
  }

  getBankAccountDetails () {
    let processResult = (res) => {
      if (res.status_code === 200) {
        return new BankAccount(res);
      } else {
        console.error('Failed to get bank account details', res.status_code, res.message);
        return Promise.reject(res.message);
      }
    };

    return this._api.authPOST('/api/blockchain-v1/general/inrdepositbankaccount')
                    .then(processResult);
  }

  static idFromAPI (obj) {
    // order_id is an integer when creating a trade, but a string when listing
    return parseInt(obj.order_id);
  }

  toJSON () {
    var serialized = {
      id: this._id,
      state: this._state,
      tx_hash: this._txHash,
      confirmed: this.confirmed,
      is_buy: this.isBuy
    };

    this._delegate.serializeExtraFields(serialized, this);

    return serialized;
  }
}

module.exports = Trade;
