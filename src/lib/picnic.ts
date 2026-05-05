import axios from 'axios';

const api = axios.create({
  baseURL: '/api/picnic'
});

export const picnicApi = {
  login: async (email: string, password: string) => {
    const res = await api.post('/login', { email, password });
    return res.data;
  },
  requestMfaCode: async (token: string) => {
    const res = await api.post('/mfa/request', {}, {
      headers: { 'x-picnic-auth': token }
    });
    return res.data;
  },
  verifyMfaCode: async (token: string, code: string) => {
    const res = await api.post('/mfa/verify', { code }, {
      headers: { 'x-picnic-auth': token }
    });
    return res.data;
  },
  getFavourites: async (token: string) => {
    const res = await api.get('/favorites', {
      headers: { 'x-picnic-auth': token }
    });
    // Picnic favourites response has various sections: usually response.data is an array or has a property
    return res.data;
  },
  search: async (token: string, term: string) => {
    const res = await api.get('/search', {
      params: { term },
      headers: { 'x-picnic-auth': token }
    });
    return res.data;
  },
  addToBasket: async (token: string, productId: string, count: number = 1) => {
    const res = await api.post('/basket/add', 
      { product_id: productId, count },
      { headers: { 'x-picnic-auth': token } }
    );
    return res.data;
  }
};
