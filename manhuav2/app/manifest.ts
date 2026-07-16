import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "画芽 · 儿童漫画创作",
    short_name: "画芽",
    description: "创建漫画人物，生成属于自己的故事场景。",
    start_url: "/",
    display: "standalone",
    background_color: "#fff8e9",
    theme_color: "#ff7b55",
    orientation: "portrait",
  };
}
