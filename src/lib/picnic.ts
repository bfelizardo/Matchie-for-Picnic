import axios from 'axios';

const api = axios.create({
  baseURL: '/api/picnic'
});

export const picnicApi = {
  login: async (email: string, password: string, country: string = 'DE') => {
    const res = await api.post('/login', { email, password }, {
      headers: { 'x-picnic-country': country }
    });
    return res.data;
  },
  requestMfaCode: async (token: string, country: string = 'DE') => {
    const res = await api.post('/mfa/request', {}, {
      headers: { 
        'x-picnic-auth': token,
        'x-picnic-country': country
      }
    });
    return res.data;
  },
  verifyMfaCode: async (token: string, code: string, country: string = 'DE') => {
    const res = await api.post('/mfa/verify', { code }, {
      headers: { 
        'x-picnic-auth': token,
        'x-picnic-country': country
      }
    });
    return res.data;
  },
  getFavourites: async (token: string, country: string = 'DE') => {
    const res = await api.get('/favorites', {
      headers: { 
        'x-picnic-auth': token,
        'x-picnic-country': country
      }
    });
    // Picnic favourites response has various sections: usually response.data is an array or has a property
    return res.data;
  },
  search: async (token: string, term: string, country: string = 'DE') => {
    const res = await api.get('/search', {
      params: { term },
      headers: { 
        'x-picnic-auth': token,
        'x-picnic-country': country
      }
    });
    return res.data;
  },
  addToBasket: async (token: string, productId: string, count: number = 1, country: string = 'DE') => {
    const res = await api.post('/basket/add', 
      { product_id: productId, count },
      { 
        headers: { 
          'x-picnic-auth': token,
          'x-picnic-country': country
        } 
      }
    );
    return res.data;
  }
};
