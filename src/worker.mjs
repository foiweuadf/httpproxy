import { Buffer } from "node:buffer";

export default {
  async fetch (request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const errHandler = (err) => {
      console.error(err);
      return new Response(err.message, fixCors({ status: err.status ?? 500 }));
    };
    try {
      return doproxy(request);
    } catch (err) {
      return errHandler(err);
    }
  }
};


class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

const fixCors = ({ headers, status, statusText }) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return { headers, status, statusText };
};

const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};


function buildBaseUrl(reqUrl, t, protocol, targetPath) {
  const proxyBase = `${reqUrl.origin}/${t}/${protocol}`;
  
  // 处理以斜杠开头的路径
  const normalizedPath = targetPath.startsWith('/') 
    ? targetPath.slice(1) 
    : targetPath;
  
  // 获取域名部分（第一个路径段）
  const domain = normalizedPath.split('/')[0];
  
  return `${proxyBase}/${domain}`;
}

async function rewriteUrls(content, baseUrl) {
  // 替换相对路径为绝对路径
  return content.replace(
    /(href|src)=["']([^"']+)["']/g,
    (match, attr, path) => {
      if (path.startsWith('http') || path.startsWith('//')) {
        return match; // 跳过绝对路径
      }
      if (path.startsWith("data:image"){
        return match;
      }
      return `${attr}="${baseUrl}/${path}"`;
    }
  );
}

const ALLOWED_PROTOCOLS = ["http", "https"];

async function doproxy(req) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  
  if (parts.length < 2) {
    return new Response("Invalid path format", { status: 400 });
  }

  const [t, protocol, ...rest] = parts;
  const targetPath = rest.join("/");
  
  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    return new Response("Unsupported protocol", { status: 400 });
  }

  try {
    const targetUrl = new URL(`${protocol}://${targetPath}${url.search}`);
    const baseUrl = buildBaseUrl(url, t, protocol, targetPath);
    const headers = new Headers();

    console.log(targetUrl.toString());
    console.log(req.method);
    console.log(baseUrl);
    
    // 复制请求头（排除敏感头）
    req.headers.forEach((v, k) => {
      if (!["host", "connection"].includes(k.toLowerCase())) {
        headers.set(k, v);
      }
    });

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body: req.body,
      duplex: 'half' 
    });

    

    // 只处理HTML和CSS内容
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("text/css")) {
      const text = await response.text();
      const rewritten = await rewriteUrls(text, baseUrl);
      // console.log(rewritten);
      return new Response(rewritten, {
        status: response.status,
        headers: response.headers
      });
    }

    return response;
  } catch (e) {
    console.log(e)
    return new Response("Invalid target URL", { status: 400 });
  }
}
