
import { put, issueSignedToken, presignUrl, del } from '@vercel/blob';

const ADMIN_USER = process.env.PBW_ADMIN_USER || 'pbwadventure';
const ADMIN_PASS = process.env.PBW_ADMIN_PASS || 'pbwadventure231100';
const BLOB_STORE_ID = (process.env.BLOB_STORE_ID || '').trim();

function authorized(request) {
  return request.headers.get('x-admin-user') === ADMIN_USER &&
    request.headers.get('x-admin-pass') === ADMIN_PASS;
}

function errText(error) {
  return error?.cause?.message || error?.message || String(error);
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

async function redis(path, options = {}) {
  const url = cleanBaseUrl(
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  );
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('Upstash/Redis belum diatur.');
  }

  const r = await fetch(url + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function getRows() {
  const result = await redis('/get/pbwSubmissions2026');

  let rows = [];

  try {
    rows = result?.result ? JSON.parse(result.result) : [];
  } catch {}

  return Array.isArray(rows) ? rows : [];
}

async function saveRows(rows) {
  await redis('/set/pbwSubmissions2026', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(JSON.stringify(rows.slice(0, 500)))
  });
}

function blobOptions() {
  const options = {
    access: 'private',
    addRandomSuffix: false,
    cacheControlMaxAge: 60
  };

  if (BLOB_STORE_ID) {
    options.storeId = BLOB_STORE_ID;
  }

  return options;
}

export default async function handler(request) {
  try {

    /* =========================
       SIMPAN PENDAFTARAN + BUKTI
       ========================= */

    if (request.method === 'POST') {

      const form = await request.formData();
      const file = form.get('bukti');

      if (!(file instanceof File)) {
        return Response.json(
          {
            ok: false,
            message: 'Bukti transfer tidak ditemukan.'
          },
          { status: 400 }
        );
      }

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        return Response.json(
          {
            ok: false,
            message: 'Bukti harus JPG, PNG, atau WEBP.'
          },
          { status: 400 }
        );
      }

      if (file.size > 4 * 1024 * 1024) {
        return Response.json(
          {
            ok: false,
            message: 'Ukuran bukti terlalu besar. Maksimal 4 MB.'
          },
          { status: 400 }
        );
      }

      if (
        !BLOB_STORE_ID &&
        !process.env.BLOB_READ_WRITE_TOKEN &&
        !process.env.VERCEL_OIDC_TOKEN
      ) {
        throw new Error(
          'Koneksi Vercel Blob belum tersedia di deployment ini. Pastikan BLOB_STORE_ID tersedia lalu redeploy.'
        );
      }

      const safeName = (file.name || 'bukti-transfer')
        .replace(/[^a-zA-Z0-9._-]/g, '_');

      const pathname =
        `proofs/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}-${safeName}`;

      let blob;

      try {
        blob = await put(pathname, file, {
          ...blobOptions(),
          contentType: file.type
        });
      } catch (error) {
        throw new Error(
          `Upload ke Vercel Blob gagal: ${errText(error)}`
        );
      }

      const row = {
        id: `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,

        createdAt: new Date().toISOString(),

        nama: form.get('nama') || '',
        lahir: form.get('lahir') || '',
        gender: form.get('gender') || '',
        trip: form.get('trip') || '',
        paket: form.get('paket') || '',
        mepo: form.get('mepo') || '',
        wa: form.get('wa') || '',
        wakeluarga: form.get('wakeluarga') || '',
        instagram: form.get('instagram') || '',
        email: form.get('email') || '',
        penyakit: form.get('penyakit') || '',
        penglihatan: form.get('penglihatan') || '',
        sumber: form.get('sumber') || '',
        pengalaman: form.get('pengalaman') || '',
        khusus: form.get('khusus') || '',
        tinggi: form.get('tinggi') || '',
        berat: form.get('berat') || '',

        proofName: file.name || safeName,
        proofPathname: blob.pathname,
        proofType: file.type
      };

      try {
        const rows = await getRows();

        rows.unshift(row);

        await saveRows(rows);

      } catch (error) {

        try {
          await del(
            blob.pathname,
            BLOB_STORE_ID
              ? { storeId: BLOB_STORE_ID }
              : undefined
          );
        } catch {}

        throw new Error(
          `Bukti berhasil diunggah, tetapi data pendaftaran gagal disimpan: ${errText(error)}`
        );
      }

      return Response.json({
        ok: true,
        id: row.id
      });
    }


    /* =========================
       TAMPILKAN DATA UNTUK ADMIN
       ========================= */

    if (request.method === 'GET') {

      if (!authorized(request)) {
        return Response.json(
          {
            ok: false,
            message: 'Tidak berwenang'
          },
          { status: 401 }
        );
      }

      const rows = await getRows();

      const out = await Promise.all(
        rows.map(async r => {

          if (!r.proofPathname) {
            return r;
          }

          try {

            const tokenOptions = {
              pathname: r.proofPathname,
              operations: ['get'],
              validUntil:
                Date.now() + 15 * 60 * 1000
            };

            if (BLOB_STORE_ID) {
              tokenOptions.storeId = BLOB_STORE_ID;
            }

            const token =
              await issueSignedToken(tokenOptions);

            const signed =
              await presignUrl(token, {
                pathname: r.proofPathname,
                operation: 'get',
                validUntil:
                  Date.now() + 15 * 60 * 1000,

                ...(BLOB_STORE_ID
                  ? { storeId: BLOB_STORE_ID }
                  : {})
              });

            return {
              ...r,
              proofUrl: signed.presignedUrl
            };

          } catch {
            return r;
          }
        })
      );

      return Response.json(out);
    }


    /* =========================
       HAPUS DATA + BUKTI
       ========================= */

    if (request.method === 'DELETE') {

      if (!authorized(request)) {
        return Response.json(
          {
            ok: false,
            message: 'Tidak berwenang'
          },
          { status: 401 }
        );
      }

      const u = new URL(request.url);
      const id = u.searchParams.get('id');

      if (!id) {
        return Response.json(
          {
            ok: false,
            message: 'ID tidak ada'
          },
          { status: 400 }
        );
      }

      const rows = await getRows();
      const row = rows.find(x => x.id === id);

      await saveRows(
        rows.filter(x => x.id !== id)
      );

      if (row?.proofPathname) {

        try {
          await del(
            row.proofPathname,
            BLOB_STORE_ID
              ? { storeId: BLOB_STORE_ID }
              : undefined
          );
        } catch {}
      }

      return Response.json({
        ok: true
      });
    }


    return Response.json(
      {
        ok: false,
        message: 'Method tidak didukung'
      },
      { status: 405 }
    );

  } catch (error) {

    return Response.json(
      {
        ok: false,
        message: errText(error)
      },
      { status: 500 }
    );
  }
}
