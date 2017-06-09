let proxyquire = require('proxyquireify')(require);

describe('Unocoin', function () {
  let c;

  const API = () =>
    ({
      authGET: () => Promise.resolve(),
      authPOST: () => Promise.resolve(),
      POST: () => Promise.resolve()
    })
  ;

  let Trade = obj => obj;

  Trade.monitorPayments = function () {};
  Trade.filteredTrades = trades => [];

  let UnocoinProfile = {
    fetch: () => Promise.resolve({})
  };

  let delegate = {
    save () { return Promise.resolve(); },
    getToken: () => {}
  };

  let ExchangeDelegate = () => delegate;

  let stubs = {
    './api': API,
    './trade': Trade,
    './profile': UnocoinProfile,
    './exchange-delegate': ExchangeDelegate
  };

  let Unocoin = proxyquire('../src/unocoin', stubs);

  beforeEach(() => {
    JasminePromiseMatchers.install();
  });

  afterEach(() => {
    JasminePromiseMatchers.uninstall();
  });

  describe('class', function () {
    describe('new Unocoin()', function () {
      it('should transform an Object to a Unocoin', function () {
        // c = new Unocoin({auto_login: true}, delegate);
        // expect(c.constructor.name).toEqual('Unocoin');
      });

      it('should use fields', function () {
        c = new Unocoin({auto_login: true}, delegate);
        expect(c._auto_login).toEqual(true);
      });

      it('should require a delegate', () => {
        // eslint-disable-next-line no-new
        expect(() => { new Unocoin({auto_login: true}); }).toThrow();
      });

      it('should deserialize trades', function () {
        c = new Unocoin({
          auto_login: true,
          trades: [{}]
        }, delegate);
        expect(c.trades.length).toEqual(1);
      });
    });

    describe('Unocoin.new()', function () {
      it('sets autoLogin to true', function () {
        c = Unocoin.new(delegate);
        expect(c._auto_login).toEqual(true);
      });

      it('should require a delegate', () => expect(() => { Unocoin.new(); }).toThrow());
    });
  });

  describe('instance', function () {
    beforeEach(function () {
      c = Unocoin.new({
        email () { return 'info@blockchain.com'; },
        isEmailVerified () { return true; },
        getToken () { return 'json-web-token'; },
        save () { return Promise.resolve(); }
      });
      c._debug = false;

      return spyOn(c._api, 'POST').and.callFake(function (endpoint, data) {
        if (endpoint === 'api/v1/authentication/register') {
          if (data.email_id === 'duplicate@blockchain.com') {
            return Promise.resolve({
              status_code: 724,
              message: 'DUPLICATE_EMAIL'
            });
          } else if (data.email_id === 'fail@blockchain.com') {
            return Promise.resolve({
              status_code: 500,
              message: 'ERROR_MESSAGE'
            });
          } else {
            return Promise.resolve({
              status_code: 200,
              access_token: 'offline-token'
            });
          }
        } else {
          return Promise.reject('Unknown endpoint');
        }
      });
    });

    describe('Getter', () =>
      describe('hasAccount', () =>
        it('should use offline_token to see if user has account', function () {
          c._offlineToken = undefined;
          expect(c.hasAccount).toEqual(false);

          c._offlineToken = 'token';
          expect(c.hasAccount).toEqual(true);
        })
      )
    );

    describe('JSON serializer', function () {
      let obj = {
        user: 1,
        offline_token: 'token',
        auto_login: true
      };

      let p = new Unocoin(obj, delegate);

      it('should serialize the right fields', function () {
        let json = JSON.stringify(p, null, 2);
        let d = JSON.parse(json);
        expect(d.user).toEqual(1);
        expect(d.offline_token).toEqual('token');
        expect(d.auto_login).toEqual(true);
      });

      it('should serialize trades', function () {
        p._trades = [];
        let json = JSON.stringify(p, null, 2);
        let d = JSON.parse(json);
        expect(d.trades).toEqual([]);
      });

      it('should hold: fromJSON . toJSON = id', function () {
        let json = JSON.stringify(c, null, 2);
        let b = new Unocoin(JSON.parse(json), delegate);
        expect(json).toEqual(JSON.stringify(b, null, 2));
      });

      it('should not serialize non-expected fields', function () {
        let expectedJSON = JSON.stringify(c, null, 2);
        c.rarefield = 'I am an intruder';
        let json = JSON.stringify(c, null, 2);
        expect(json).toEqual(expectedJSON);
      });
    });

    describe('signup', function () {
      it('sets a user and offline token', function (done) {
        let checks = function () {
          expect(c.user).toEqual('info@blockchain.com');
          expect(c._offlineToken).toEqual('offline-token');
        };

        let promise = c.signup().then(checks);

        expect(promise).toBeResolved(done);
      });

      it('requires email', function () {
        c.delegate.email = () => null;
        expect(c.signup()).toBeRejected();
      });

      it('requires verified email', function () {
        c.delegate.isEmailVerified = () => false;
        expect(c.signup()).toBeRejected();
      });

      it('lets the user know if email is already registered', function (done) {
        c.delegate.email = () => 'duplicate@blockchain.com';
        let promise = c.signup();
        expect(promise).toBeRejectedWith(jasmine.objectContaining({error: 'email_already_used'}), done);
      });

      it('might fail for an unexpected reason', function (done) {
        c.delegate.email = () => 'fail@blockchain.com';
        let promise = c.signup();
        expect(promise).toBeRejectedWith(jasmine.objectContaining({message: 'ERROR_MESSAGE'}), done);
      });
    });

    describe('getBuyCurrencies()', function () {
      beforeEach(() =>
        spyOn(c, 'getBuyMethods').and.callFake(() =>
          Promise.resolve([
            {
              inCurrencies: ['INR']
            },
            {
              inCurrencies: ['INR']
            }
          ])
        )
      );

      it('should return a list of currencies', function (done) {
        let checks = res => expect(res).toEqual(['INR']);

        let promise = c.getBuyCurrencies().then(checks);

        expect(promise).toBeResolved(done);
      });

      it('should store the list', function (done) {
        let checks = function (res) {
          expect(c.buyCurrencies).toEqual(['INR']);
          return done();
        };

        c.getBuyCurrencies().then(checks);
      });
    });

    describe('getSellCurrencies()', function () {
      beforeEach(() =>
        spyOn(c, 'getSellMethods').and.callFake(() =>
          Promise.resolve([
            {
              outCurrencies: ['INR']
            },
            {
              outCurrencies: ['INR']
            }
          ])
        )
      );

      it('should return a list of currencies', function (done) {
        let checks = res => expect(res).toEqual(['INR']);

        let promise = c.getSellCurrencies().then(checks);

        expect(promise).toBeResolved(done);
      });

      it('should store the list', function (done) {
        let checks = function (res) {
          expect(c.sellCurrencies).toEqual(['INR']);
          return done();
        };

        c.getSellCurrencies().then(checks);
      });
    });

    describe('fetchProfile()', function () {
      it('should call fetch() on Profile', function () {
        spyOn(UnocoinProfile, 'fetch').and.callThrough();
        c.fetchProfile();
        expect(UnocoinProfile.fetch).toHaveBeenCalled();
      });

      it('profile should be null before', () => {
        expect(c.profile).toBeNull();
      });

      it('should set .profile', function (done) {
        let checks = () => {
          expect(c.profile).not.toBeNull();
        };
        c.fetchProfile().then(checks).then(done);
      });
    });
  });
});
