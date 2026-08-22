import hero0 from "./hero0";
import hero1 from "./hero1";
import hero2 from "./hero2";
import hero3 from "./hero3";
import hero4 from "./hero4";
import hero5 from "./hero5";

const heroData=`data:image/jpeg;base64,${hero0}${hero1}${hero2}${hero3}${hero4}${hero5}`;
document.documentElement.style.setProperty("--public-hero-image",`url("${heroData}")`);
